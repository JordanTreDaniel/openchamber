import { onDemand } from '../uiBlocks/useUiBlockComponent';

/**
 * A `vq` fence with its answer, loaded with the first fence on screen: null
 * until then, or when loading failed. The fence reads its answer back from the
 * session sync, so it stays out of the Markdown renderer's chunk the same way
 * a reply's UI block does (`useReplyUiBlockComponent`).
 */
export const useVqReplyBlockComponent = onDemand(() => import('../uiBlocks/VqReplyUiBlock').then((module) => module.VqReplyUiBlock));
