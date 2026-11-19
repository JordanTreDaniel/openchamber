import type { CustomRendererProps } from 'streamdown';
import { useVqReplyBlockComponent } from './vq/useVqReplyBlockComponent';

/**
 * `vq` fences of an assistant reply: the body names a component and the data
 * it shows, either inline or as a file to load (`lib/vq/source.ts`). The answer
 * goes back through the same channel as every other reply block, so the agent
 * reads it in the next turn and the block shows it again after a reload.
 *
 * The fence loads with the first one on screen (`VqReplyUiBlock`): it reads the
 * answer back from the session sync, which the Markdown renderer stays out of.
 */
export function MarkdownVqBlock({ code, isIncomplete }: CustomRendererProps) {
  const VqReplyBlock = useVqReplyBlockComponent();
  // A fence still arriving is not JSON yet; show it as written.
  if (isIncomplete || !VqReplyBlock) return <pre dir="ltr"><code>{code}</code></pre>;
  return <VqReplyBlock code={code} />;
}
