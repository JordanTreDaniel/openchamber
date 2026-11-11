import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useChatSessionSelection } from '@/components/chat/chatColumnSession';
import { useI18n } from '@/lib/i18n';
import type { I18nKey } from '@/lib/i18n/messages/en';
import type { LiveVoiceStatus, TranscriptEntry } from '@/lib/voice/live/live-voice-store';
import { useLiveVoiceStore } from '@/lib/voice/live/live-voice-store';
import { getLiveVoiceClient } from '@/lib/voice/live/live-voice-client';
import { DEFAULT_VOICE } from '@/lib/voice/live/realtime-protocol';
import { cn } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { filterVisibleAgents, useAgentsStore } from '@/stores/useAgentsStore';

/**
 * Live voice: talk to the session on screen, out loud.
 *
 * The panel is a window onto one module-level client (see
 * `lib/voice/live/live-voice-client.ts`), so closing it or switching surfaces
 * never ends a conversation — only Stop does. Everything here is a read of
 * that client's store plus four actions: start, stop, interrupt, clear.
 */

/** One dot per state, in the app's status colours; only state, never decoration. */
const STATUS_TONE: Record<LiveVoiceStatus, { dot: string; label: I18nKey }> = {
  idle: { dot: 'bg-muted-foreground/40', label: 'liveVoice.status.idle' },
  connecting: { dot: 'bg-status-info/60', label: 'liveVoice.status.connecting' },
  listening: { dot: 'bg-status-success', label: 'liveVoice.status.listening' },
  delegating: { dot: 'bg-status-info', label: 'liveVoice.status.delegating' },
  working: { dot: 'bg-status-info', label: 'liveVoice.status.working' },
  ended: { dot: 'bg-muted-foreground/40', label: 'liveVoice.status.ended' },
  error: { dot: 'bg-status-error', label: 'liveVoice.status.error' },
};

/**
 * Only `marin` is verified against `gpt-live`; the rest are the realtime
 * voices OpenAI documents, offered because a wrong one is refused at mint
 * with an error this panel shows. It never silently falls back.
 */
const VOICES = [DEFAULT_VOICE, 'alloy', 'shimmer', 'echo', 'coral', 'verse'] as const;

const TRANSCRIPT_LABEL: Record<TranscriptEntry['kind'], I18nKey | null> = {
  you: 'liveVoice.transcript.you',
  voice: 'liveVoice.transcript.voice',
  agent: 'liveVoice.transcript.agent',
  spoken: 'liveVoice.transcript.spoken',
  marker: null,
  error: null,
};

const useSessionTitle = (sessionId: string | null): string | null => {
  const sessions = useGlobalSessionsStore((state) => state.activeSessions);
  if (!sessionId) return null;
  return sessions.find((session) => session.id === sessionId)?.title?.trim() || null;
};

export const LiveVoicePanel: React.FC = () => {
  const { t } = useI18n();
  const chat = useChatSessionSelection();

  const status = useLiveVoiceStore((state) => state.status);
  const running = useLiveVoiceStore((state) => state.running);
  const error = useLiveVoiceStore((state) => state.error);
  const transcript = useLiveVoiceStore((state) => state.transcript);
  const binding = useLiveVoiceStore((state) => state.binding);
  const pendingQuestion = useLiveVoiceStore((state) => state.pendingQuestion);
  const voice = useLiveVoiceStore((state) => state.voice);
  const configuredAgent = useLiveVoiceStore((state) => state.agentName);

  const agents = useAgentsStore((state) => state.agents);
  const fallbackAgent = useConfigStore((state) => state.currentAgentName);
  const visibleAgents = React.useMemo(() => filterVisibleAgents(agents), [agents]);
  const agentName = configuredAgent ?? fallbackAgent ?? visibleAgents[0]?.name ?? '';

  const title = useSessionTitle(binding?.sessionId ?? null);

  // Bind to the chat on screen the first time the panel is looked at, and
  // never rebind a live conversation out from under the user.
  React.useEffect(() => {
    if (running || binding) return;
    if (!chat.sessionId || !chat.directory) return;
    getLiveVoiceClient().bind({
      sessionId: chat.sessionId,
      directory: chat.directory,
      title: useGlobalSessionsStore.getState().activeSessions.find((session) => session.id === chat.sessionId)?.title ?? null,
    });
  }, [binding, chat.directory, chat.sessionId, running]);

  const bindToCurrentChat = React.useCallback(() => {
    if (running || !chat.sessionId || !chat.directory) return;
    getLiveVoiceClient().bind({
      sessionId: chat.sessionId,
      directory: chat.directory,
      title: useGlobalSessionsStore.getState().activeSessions.find((session) => session.id === chat.sessionId)?.title ?? null,
    });
  }, [chat.directory, chat.sessionId, running]);

  const client = getLiveVoiceClient();
  const tone = STATUS_TONE[status];
  const canStart = Boolean(binding) && !running;
  const showReconnect = !running && (status === 'error' || status === 'ended');

  const scrollRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [transcript]);

  const chatDiffers = Boolean(chat.sessionId) && chat.sessionId !== binding?.sessionId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
          <span className="truncate text-xs font-medium text-foreground">{t(tone.label)}</span>
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => client.clearTranscript()}
              title={t('liveVoice.action.clear')}
              aria-label={t('liveVoice.action.clear')}
              disabled={transcript.length === 0}
            >
              <Icon name="delete-bin" className="size-4" />
            </Button>
            {running ? (
              <Button size="sm" variant="outline" onClick={() => client.stop()}>
                {t('liveVoice.action.stop')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="default"
                disabled={!canStart}
                onClick={() => {
                  if (showReconnect) void client.reconnect();
                  else void client.start();
                }}
              >
                {showReconnect ? t('liveVoice.action.reconnect') : t('liveVoice.action.start')}
              </Button>
            )}
          </div>
        </div>

        <dl className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">{t('liveVoice.session.label')}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1">
              <span className="min-w-0 truncate text-xs text-foreground">
                {binding ? (title || binding.sessionId) : t('liveVoice.session.none')}
              </span>
              {!running && chatDiffers ? (
                <Button size="xs" variant="link" className="shrink-0" onClick={bindToCurrentChat}>
                  {t('liveVoice.session.useCurrent')}
                </Button>
              ) : null}
            </dd>
          </div>

          <div className="flex items-center gap-1.5">
            <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">{t('liveVoice.agent.label')}</dt>
            <dd className="min-w-0 flex-1">
              <Select
                value={agentName}
                onValueChange={(value) => useLiveVoiceStore.getState().setAgentName(value)}
              >
                <SelectTrigger className="w-full" aria-label={t('liveVoice.agent.label')}>
                  <SelectValue>{agentName || t('liveVoice.agent.label')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {visibleAgents.map((agent) => (
                    <SelectItem key={agent.name} value={agent.name}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>
          </div>

          <div className="flex items-center gap-1.5">
            <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">{t('liveVoice.voice.label')}</dt>
            <dd className="min-w-0 flex-1">
              <Select
                value={voice}
                onValueChange={(value) => useLiveVoiceStore.getState().setVoice(value)}
                disabled={running}
              >
                <SelectTrigger className="w-full" aria-label={t('liveVoice.voice.label')}>
                  <SelectValue>{voice}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {VOICES.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>
          </div>
        </dl>
      </div>

      {error ? (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-md bg-status-error/10 px-2 py-1.5">
          <Icon name="error-warning" className="mt-0.5 size-3.5 shrink-0 text-status-error" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground">{error}</p>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => useLiveVoiceStore.getState().setError(null)}
          >
            {t('liveVoice.action.dismiss')}
          </Button>
        </div>
      ) : null}

      {pendingQuestion ? (
        <div className="mx-3 mb-2 flex flex-col gap-1.5 rounded-md bg-status-warning/10 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Icon name="question" className="size-3.5 shrink-0 text-status-warning" />
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
              {pendingQuestion.title || t('liveVoice.question.title')}
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t('liveVoice.question.hint')}</p>
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={() => useSessionUIStore.getState().setCurrentSession(pendingQuestion.sessionId, binding?.directory ?? null)}
            >
              {t('liveVoice.action.openChat')}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => client.interruptForQuestion()}>
              {t('liveVoice.action.interrupt')}
            </Button>
          </div>
        </div>
      ) : null}

      <ScrollableOverlay
        outerClassName="min-h-0 flex-1"
        disableHorizontal
        ref={scrollRef}
      >
        {transcript.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {t('liveVoice.transcript.empty')}
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5 px-3 py-2">
            {transcript.map((entry) => {
              const labelKey = TRANSCRIPT_LABEL[entry.kind];
              if (!labelKey) {
                const isError = entry.kind === 'error';
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      'text-[11px] leading-relaxed',
                      isError ? 'text-status-error' : 'text-muted-foreground',
                    )}
                  >
                    {entry.text}
                  </li>
                );
              }
              return (
                <li key={entry.id} className="flex gap-2">
                  <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{t(labelKey)}</span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed',
                      entry.kind === 'spoken' ? 'text-foreground' : 'text-foreground/80',
                    )}
                  >
                    {entry.text}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </ScrollableOverlay>

      <p className="shrink-0 border-t border-edge-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {t('liveVoice.hint.mic')}
      </p>
    </div>
  );
};
