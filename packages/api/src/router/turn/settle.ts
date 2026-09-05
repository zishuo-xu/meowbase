import { randomUUID } from 'node:crypto';
import {
  isVoidableApprovalStatus,
  parseHoldExit,
  parseLearnCommand,
} from '@meowbase/shared';
import type { EvidenceEntry, MentionCatalog, Message, TeamMember } from '@meowbase/shared';
import { gitAddAll, gitDiffHead, resolveDiffMarker } from '../../services/git.js';
import {
  formatApprovalVoidReason,
  formatApprovalVoidedNote,
  formatPrReviewWakeTask,
} from '../../services/pr.js';
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

  const oversteps = lastResult.oversteps ?? [];
  const mergedPr = lastResult.mergedPr;
  if (oversteps.length > 0 || mergedPr) {
    if (oversteps.length > 0) {
      const primary = oversteps[0]!;
      await writeQueue(() =>
        context.stores.messages.append({
          threadId,
          role: 'system',
          content: oversteps.map((item) => item.note).join('\n'),
          status: 'completed',
          systemKind: 'git-overstep',
          systemMeta: {
            baseBranch: primary.baseBranch,
            side: primary.side,
            ...(primary.beforeSha ? { beforeSha: primary.beforeSha } : {}),
            ...(primary.afterSha ? { afterSha: primary.afterSha } : {}),
          },
        }),
      );
      turnLog('git-overstep', {
        thread: threadId,
        baseBranch: primary.baseBranch,
        before: clip(primary.beforeSha ?? '', 12),
        after: clip(primary.afterSha ?? '', 12),
      });
    }
    if (mergedPr) {
      await writeQueue(() =>
        context.stores.messages.append({
          threadId,
          role: 'system',
          content: mergedPr.note,
          status: 'completed',
          systemKind: 'pr-merged',
          systemMeta: {
            prNumber: mergedPr.number,
            prUrl: mergedPr.url,
            headRefOid: mergedPr.headRefOid,
          },
        }),
      );
      turnLog('pr-merged', {
        thread: threadId,
        number: mergedPr.number,
        sha: clip(mergedPr.headRefOid, 12),
      });
      const reason = formatApprovalVoidReason(mergedPr.number);
      const open = (await context.stores.approvals.list(threadId)).filter((card) =>
        isVoidableApprovalStatus(card.status),
      );
      for (const card of open) {
        const voided = await context.stores.approvals.void(card.id, reason);
        if (!voided) continue;
        await writeQueue(() =>
          context.stores.messages.append({
            threadId,
            role: 'system',
            content: formatApprovalVoidedNote({ cardId: voided.id, reason }),
            status: 'completed',
            systemKind: 'notice',
          }),
        );
      }
    }
    await context.stores.threads.setPendingHop(threadId, null);
    await context.stores.threads.clearPendingQueue(threadId);
    return lastAssistant;
  }

  const pending = (await context.stores.threads.get(threadId))?.pendingHop;
  // 槽里还是刚跑完的那一棒 ≠ 下一棒已写下;要等下一棒才跳过审查
  const waiting = Boolean(pending && pending.id !== lastAssistant.hopId);
  const holding = Boolean(parseHoldExit(lastOutput.content ?? ''));

  // PR 评论回流:链已停且来了人写的评论,把写手叫起来处理。
  // 四条护栏:交接中的棒(waiting)不许覆盖;槽里搁着等跑命令(holdCommand)不叫醒;
  // 纯持球(holding)是「人开口即取消」,平台不能用叫醒自动取消;
  // 叫醒过就跳过本轮建卡(卡上冻结的不能是处理评论之前的旧 diff)。
  const humanReviews = (lastResult.prReviews ?? []).filter((r) => r.item.authorType === 'User');
  let wokeForReview = false;
  if (
    lastOutput.status === 'completed' &&
    humanReviews.length > 0 &&
    !waiting &&
    !holding &&
    !pending?.holdCommand
  ) {
    const writerAgentId = chainFirstAgent ?? thread.primaryAgentId;
    const first = humanReviews[0]!;
    await context.stores.threads.setPendingHop(threadId, {
      id: randomUUID(),
      to: writerAgentId,
      from: writerAgentId,
      task: formatPrReviewWakeTask({
        comments: humanReviews.map((r) => r.item),
        number: first.prNumber,
        url: first.prUrl,
      }),
      goal: '处理 PR 上的新评论',
      previousOutput: lastOutput.content ?? '',
      visited: [writerAgentId],
      firstAgent: writerAgentId,
      hop: 0,
    });
    wokeForReview = true;
    turnLog('pr-review wake', { thread: threadId, to: writerAgentId, count: humanReviews.length });
  }

  if (lastOutput.status === 'completed' && !waiting && !holding && !wokeForReview) {
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
