import type { ThreadRepo } from '@meowbase/shared';
import { tryLandApproval, type LandApprovalResult } from '../../services/git.js';
import type { TurnContext } from './types.js';

/** 批准决策已记下之后,尝试 commit 并前进 marker。失败不 markApplied。 */
export async function landApprovedCard(input: {
  context: TurnContext;
  threadId: string;
  workdir: string;
  cardId: string;
  repo?: ThreadRepo;
}): Promise<LandApprovalResult> {
  const land = await tryLandApproval({
    dir: input.workdir,
    message: `approve ${input.cardId}`,
    repo: input.repo,
  });
  if (!land.ok) return land;
  await input.context.stores.approvals.markApplied(input.cardId);
  if (input.repo && land.headSha) {
    await input.context.stores.threads.setLastApprovedSha(input.threadId, land.headSha);
  }
  return land;
}
