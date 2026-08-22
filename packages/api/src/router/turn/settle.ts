import { parseHoldExit, parseLearnCommand } from '@meowbase/shared';
import type { EvidenceEntry, MentionCatalog, Message, TeamMember } from '@meowbase/shared';
import { gitAddAll, gitDiffHead, resolveDiffMarker } from '../../services/git.js';
import { clip, turnLog } from '../../services/turn-log.js';
import { runReviewFixThenCard } from './review.js';
import type { SegmentRunResult, ThreadRuntime, TurnContext, WriteQueue } from './types.js';

export async function settleTurn(input: {
  threadId: string;
  context: TurnContext;
  thread: ThreadRuntime;
  learn?: ReturnType<typeof parseLearnCommand>;
  lastResult: SegmentRunResult;
  writeQueue: WriteQueue;
  catalog: MentionCatalog;
  team: readonly TeamMember[];
  refs: EvidenceEntry[];
}): Promise<Message> {
  const { threadId, context, thread, learn, lastResult, writeQueue, catalog, team, refs } = input;
  const { lastAssistant, lastOutput, firstAgent: chainFirstAgent } = lastResult;

  if (learn && lastOutput.status === 'completed' && lastOutput.content) {
    const draft = await context.stores.evidence.createDraft({
      threadId,
      kind: 'fact',
      title: learn.title,
      content: lastOutput.content,
    });
    await context.stores.messages.append({
      threadId,
      role: 'system',
      content: `💡 建议沉淀为证据:「${draft.title}」\n回复 #confirm ${draft.id} 确认`,
      status: 'completed',
      systemKind: 'notice',
    });
  }

  const pending = (await context.stores.threads.get(threadId))?.pendingHop;
  // 槽里还是刚跑完的那一棒 ≠ 下一棒已写下;要等下一棒才跳过审查
  const waiting = Boolean(pending && pending.id !== lastAssistant.hopId);
  const holding = Boolean(parseHoldExit(lastOutput.content ?? ''));
  if (lastOutput.status === 'completed' && !waiting && !holding) {
    try {
      await gitAddAll(thread.workdir);
      const from = await resolveDiffMarker(thread.workdir, thread.repo);
      const diff = await gitDiffHead(thread.workdir, from);
      if (diff) {
        turnLog('diff', { thread: threadId, stat: clip(diff.stat, 80) });
        const writerAgentId = chainFirstAgent ?? thread.primaryAgentId;
        await runReviewFixThenCard({
          context,
          thread,
          threadId,
          writerAgentId,
          chainLastAgent: lastAssistant.agentId,
          chainLastContent: lastOutput.content,
          initialDiff: diff,
          writeQueue,
          catalog,
          team,
          refs,
        });
      }
    } catch (err) {
      turnLog('diff fail', { thread: threadId, error: clip(String(err), 120) });
    }
  }

  return lastAssistant;
}
