import React from 'react';
import type { CustomRendererProps } from 'streamdown';
import type { Answer, Theme, VQProps } from 'vq-react';
import {
  loadVqSource,
  vqTableColumns,
  VqSourceError,
  type ResolvedVqSource,
  type VqSourceSpec,
} from '@/lib/vq/source';
import { buildVqAnswerPayload, vqAnswerText } from '@/lib/vq/answer';
import { installVqWriter, useVqWriteResult } from '@/lib/vq/writer';
import { uiBlockKey } from './uiBlocks/answer';
import { useMarkdownPresentation } from './markdown/MarkdownPresentationContext';

/**
 * `vq` fences of an assistant reply: the body names a component and the data
 * it shows, either inline or as a file to load (`lib/vq/source.ts`). The answer
 * goes back through the same channel as every other reply block, so the agent
 * reads it in the next turn and the block shows it again after a reload.
 *
 * The component library itself is imported on demand: most replies draw no
 * fence, and only the app's bundle resolves its alias.
 */

interface VqRuntime {
  VQ: React.ComponentType<VQProps>;
  theme: Partial<Theme>;
}

let vqRuntime: VqRuntime | null = null;
let vqRuntimeRequest: Promise<VqRuntime> | null = null;

function loadVqRuntime(): Promise<VqRuntime> {
  if (vqRuntime) return Promise.resolve(vqRuntime);
  if (!vqRuntimeRequest) {
    vqRuntimeRequest = import('vq-react').then((module) => {
      // Before the first fence can answer: an answer writes itself to the
      // folder its spec names, which the app's writer does and the browser's
      // folder picker cannot. Idempotent with the install at startup.
      installVqWriter(module);
      vqRuntime = {
        VQ: module.VQ,
        // Host tokens by bare variable name: `hostTheme` wraps each one in var() itself.
        theme: module.hostTheme({
          accent: '--primary',
          bg: '--surface-background',
          text: '--surface-foreground',
          muted: '--surface-muted-foreground',
          surface: '--surface-elevated',
          border: '--interactive-border',
        }),
      };
      return vqRuntime;
    });
    // A failed chunk must not be remembered: the next fence tries again.
    vqRuntimeRequest.catch(() => {
      vqRuntimeRequest = null;
    });
  }
  return vqRuntimeRequest;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The writer's first reason, short enough for one muted line. */
const writeFailure = (errors: string[] | undefined): string => {
  const reason = (errors ?? []).find((entry) => entry.trim()) ?? 'no reason given';
  return reason.length > 140 ? `${reason.slice(0, 137)}…` : reason;
};

const VqCode = ({ code }: { code: string }) => <pre dir="ltr"><code>{code}</code></pre>;

/** The fence as written, with the reason it stayed text. Never a blank section. */
const VqFallback = ({ code, note }: { code: string; note: string }) => (
  <div dir="ltr" className="min-w-0">
    <p className="text-xs text-muted-foreground">{note}</p>
    <VqCode code={code} />
  </div>
);

type ParsedVq = { ok: true; spec: Record<string, unknown> } | { ok: false; error: string };

function parseVqBody(code: string): ParsedVq {
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch (error) {
    return { ok: false, error: `vq block: invalid JSON — ${messageOf(error)}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'vq block: invalid JSON — expected an object' };
  }
  const spec = parsed as Record<string, unknown>;
  if (typeof spec.type !== 'string' || !spec.type) return { ok: false, error: 'vq block: missing a "type"' };
  return { ok: true, spec };
}

function readSource(spec: Record<string, unknown>): VqSourceSpec | null {
  const source = spec.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const candidate = source as Partial<VqSourceSpec>;
  if (typeof candidate.path !== 'string' || !candidate.path.trim() || !candidate.fields) return null;
  return candidate as VqSourceSpec;
}

type WidgetState =
  | { kind: 'none' }
  | { kind: 'loading'; path: string }
  | { kind: 'ready'; resolved: ResolvedVqSource }
  | { kind: 'failed'; message: string };

interface BoundaryState {
  failed: boolean;
  source: string;
  message: string;
}

/** A crash in the component must cost the fence, not the message around it. */
class VqFenceBoundary extends React.Component<{ code: string; children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false, source: this.props.code, message: '' };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failed: true, message: messageOf(error) };
  }

  static getDerivedStateFromProps(props: { code: string }, state: BoundaryState): Partial<BoundaryState> | null {
    return props.code === state.source ? null : { failed: false, source: props.code, message: '' };
  }

  componentDidCatch(error: unknown) {
    console.error('[vq-fence]', error);
  }

  render() {
    if (this.state.failed) return <VqFallback code={this.props.code} note={`vq block: render failed — ${this.state.message}`} />;
    return this.props.children;
  }
}

function VqSpec({ spec, code }: { spec: Record<string, unknown>; code: string }) {
  const { settledReply, directory } = useMarkdownPresentation();
  const type = typeof spec.type === 'string' ? spec.type : '';
  const specId = typeof spec.id === 'string' && spec.id ? spec.id : type;
  const source = readSource(spec);
  const sourceError = (source || spec.source === undefined) ? null : 'vq block: "source" needs a path and fields';

  const [state, setState] = React.useState<WidgetState>(() => {
    if (sourceError) return { kind: 'failed', message: sourceError };
    return source ? { kind: 'loading', path: source.path } : { kind: 'none' };
  });
  const [answered, setAnswered] = React.useState<string | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<string[]>([]);
  const issuesKey = React.useRef('');
  const [runtime, setRuntime] = React.useState<VqRuntime | null>(vqRuntime);
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (runtime) return;
    let live = true;
    loadVqRuntime().then(
      (loaded) => {
        if (live) setRuntime(loaded);
      },
      (error: unknown) => {
        if (live) setRuntimeError(`vq block: component failed to load — ${messageOf(error)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [runtime]);

  React.useEffect(() => {
    if (!source) return;
    let live = true;
    setState((current) => (current.kind === 'loading' && current.path === source.path
      ? current
      : { kind: 'loading', path: source.path }));
    loadVqSource(type, source).then(
      (resolved) => {
        if (live) setState({ kind: 'ready', resolved });
      },
      (error: unknown) => {
        if (!live) return;
        setState({
          kind: 'failed',
          message: error instanceof VqSourceError ? error.message : `vq source ${source.path}: ${messageOf(error)}`,
        });
      },
    );
    return () => {
      live = false;
    };
  }, [source, type]);

  // Null while the reply streams and outside a reply: there is nothing to answer to yet.
  const target = React.useMemo(
    () => (settledReply && directory ? { ...settledReply, directory, block: uiBlockKey(code) } : null),
    [settledReply, directory, code],
  );

  const handleInvalid = React.useCallback((next: string[]) => {
    const key = next.join('\n');
    if (key === issuesKey.current) return;
    issuesKey.current = key;
    // VQ reports a bad spec from its render pass, so the note waits for that pass to end.
    queueMicrotask(() => setIssues(next));
  }, []);

  const handleAnswer = React.useCallback((answer: Answer) => {
    if (!target) return;
    setSendError(null);
    // Loaded on send: the session sync behind the channel stays out of the Markdown renderer.
    void import('./uiBlocks/replyAnswer')
      .then((module) => module.sendUiBlockReplyAnswer(target, buildVqAnswerPayload(specId, answer), vqAnswerText(specId, answer)))
      .then(() => setAnswered(answer.label))
      .catch((error: unknown) => setSendError(`vq answer not sent: ${messageOf(error)}`));
  }, [target, specId]);

  const resolvedSpec = React.useMemo(() => {
    // Without a file the fence carries its data, and it goes to the component as written.
    if (!source) {
      const inline: Record<string, unknown> = { ...spec };
      delete inline.source;
      return inline;
    }
    if (state.kind !== 'ready') return null;
    const built: Record<string, unknown> = { ...spec };
    // The source is an instruction to this renderer, not a prop of the component.
    delete built.source;
    built[state.resolved.prop] = state.resolved.data;
    if (state.resolved.prop === 'rows') built.columns = vqTableColumns(source.fields);
    return built;
  }, [state, source, spec]);

  // Where this fence's files were meant to go. The writer keeps each folder's
  // last write, so a failure shows here instead of a clean "Answered" that
  // claims files which never reached the disk.
  const outputFolder = React.useMemo(() => {
    const output = spec.output as { path?: unknown } | undefined;
    return typeof output?.path === 'string' && output.path.trim() ? output.path.trim() : undefined;
  }, [spec]);
  const writeResult = useVqWriteResult(outputFolder);

  if (state.kind === 'failed') return <VqFallback code={code} note={state.message} />;
  if (runtimeError) return <VqFallback code={code} note={runtimeError} />;
  if (state.kind === 'loading') return <p dir="ltr" className="text-xs text-muted-foreground break-all">vq: loading {state.path}</p>;
  if (!resolvedSpec) return <VqFallback code={code} note="vq block: no data resolved" />;
  if (!runtime) return <p dir="ltr" className="text-xs text-muted-foreground">vq: loading component</p>;

  const { VQ, theme } = runtime;

  return (
    <div data-vq-block={specId} dir="ltr" className="min-w-0">
      {issues.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">vq block: invalid spec — {issues.join('; ')}</p>
          <VqCode code={code} />
        </>
      ) : (
        <VqFenceBoundary code={code}>
          <VQ spec={resolvedSpec} scheme="auto" theme={theme} onAnswer={handleAnswer} onInvalid={handleInvalid} />
        </VqFenceBoundary>
      )}
      {answered !== null && <p className="mt-1 text-xs text-muted-foreground">Answered · {answered}</p>}
      {answered !== null && writeResult?.ok === false && (
        <p className="mt-1 text-xs text-muted-foreground">output not written — {writeFailure(writeResult.errors)}</p>
      )}
      {sendError !== null && <p className="mt-1 text-xs text-muted-foreground">{sendError}</p>}
    </div>
  );
}

export function MarkdownVqBlock({ code, isIncomplete }: CustomRendererProps) {
  // A fence still arriving is not JSON yet; show it as written.
  if (isIncomplete) return <VqCode code={code} />;
  return <VqFence code={code} />;
}

function VqFence({ code }: { code: string }) {
  const parsed = React.useMemo(() => parseVqBody(code), [code]);
  if (!parsed.ok) return <VqFallback code={code} note={parsed.error} />;
  // Keyed by the body: a rewritten fence starts over instead of showing the old load.
  return <VqSpec key={code} spec={parsed.spec} code={code} />;
}
