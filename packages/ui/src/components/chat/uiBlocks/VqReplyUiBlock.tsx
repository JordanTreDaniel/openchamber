import React from 'react';
import { useMarkdownPresentation } from '../markdown/MarkdownPresentationContext';
import { VqFence, type VqReplyTarget } from '../vq/VqFence';
import { uiBlockKey } from './answer';
import { useUiBlockReplyAnswer } from './replyAnswer';

/**
 * A `vq` fence of an assistant reply with its answer: the fence sends through
 * the same synthetic input as every other reply block (`replyAnswer.ts`), and
 * shows those choices again after a reload. Loaded on demand with the first
 * fence, so the Markdown renderer does not carry the session sync it reads.
 */
export function VqReplyUiBlock({ code }: { code: string }) {
  const { settledReply, directory } = useMarkdownPresentation();
  // Null while the reply streams and outside a reply: there is nothing to answer to yet.
  const target = React.useMemo<VqReplyTarget | null>(
    () => (settledReply && directory ? { ...settledReply, directory, block: uiBlockKey(code) } : null),
    [settledReply, directory, code],
  );
  const answered = useUiBlockReplyAnswer(target);
  return <VqFence code={code} target={target} answered={answered} />;
}
