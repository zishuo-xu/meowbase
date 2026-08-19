import { resolve } from 'node:path';
import { killHoldCommand } from '../services/hold-command.js';
import {
  formatEscalatedBallNote,
  formatHopInterruptedNote,
  isPlaceholderTitle,
  shouldResumePending,
  parseEvidenceRefs,
  parseLearnCommand,
  matchEvidence,
  wantsEvidenceRecall,
  resolveTurnTargets,
  titleFromUserMessage,
  stripMentions,
} from '@meowbase/shared';
import type {
  AgentId,
  EvidenceEntry,
  Message,
} from '@meowbase/shared';
import { clip, turnLog } from '../services/turn-log.js';
import {
  MAX_A2A_DEPTH,
  type SegmentRunResult,
  type TurnContext,
} from './turn/types.js';
import { createWriteQueue } from './turn/write-queue.js';
import {
  loadRoster,
  userEscalates,
} from './turn/context.js';
import { handleSystemCommand } from './turn/system-commands.js';
import { runSegment } from './turn/segment.js';
import { settleTurn } from './turn/settle.js';
import { finishHoldCommandThenWake } from './turn/hold.js';

export { MAX_A2A_DEPTH, MAX_REVIEW_FIX_ROUNDS } from './turn/types.js';
export type { TurnContext } from './turn/types.js';

export async function executeTurn(input: {
  threadId: string;
  content: string;
  context: TurnContext;
}): Promise<Message> {
  const { threadId, content, context } = input;

  const thread = await context.stores.threads.get(threadId);
  if (!thread) throw new Error(`线程不存在: ${threadId}`);
  thread.workdir = resolve(thread.workdir);

  await context.stores.messages.append({
    threadId,
    role: 'user',
    content,
    status: 'completed',
  });

  // 系统命令分支:纯系统操作,不路由给 agent
  const handled = await handleSystemCommand({
    threadId,
    content,
    context,
    workdir: thread.workdir,
  });
  if (handled) return handled;

  const learn = parseLearnCommand(content);
  const refIds = parseEvidenceRefs(content);
  const refs: EvidenceEntry[] = [];
  for (const id of refIds) {
    const entry = await context.stores.evidence.get(id);
    if (entry?.status === 'confirmed') refs.push(entry);
  }
  if (wantsEvidenceRecall(content)) {
    const recalled = matchEvidence(content, await context.stores.evidence.list());
    for (const entry of recalled) {
      if (!refs.some((item) => item.id === entry.id)) refs.push(entry);
    }
  }

  // 多 @ 同题并行:各占一行的行首 @ 才是目标;同一正文发给每个目标;A2A 接力各自串行;失败隔离
  const { catalog, team, maxDepth } = await loadRoster(context);
  const history = await context.stores.messages.list(threadId);
  if (
    history.filter((m) => m.role === 'user').length === 1 &&
    isPlaceholderTitle(thread.title)
  ) {
    const nextTitle = titleFromUserMessage(content);
    if (nextTitle) await context.stores.threads.rename(threadId, nextTitle);
  }
  const priorUsers = history.filter((m) => m.role === 'user').slice(0, -1);
  const lastSpeakerId = [...history]
    .reverse()
    .find((m) => m.role === 'assistant' && m.agentId)?.agentId;
  const targets = resolveTurnTargets(content, {
    primaryAgentId: thread.primaryAgentId,
    recentUserMessages: priorUsers.map((m) => ({
      content: m.content,
      createdAt: m.createdAt,
    })),
    lastAssistantAgentId: lastSpeakerId,
    catalog,
  });
  turnLog('turn start', {
    thread: threadId,
    targets: targets.join(','),
    preview: clip(content),
  });
  const writeQueue = createWriteQueue();
  const pending = thread.pendingHop;
  if (pending) {
    if (pending.holdCommand) {
      killHoldCommand(threadId);
      await context.stores.threads.setPendingHop(threadId, null);
    } else if (shouldResumePending(content, pending.to, catalog)) {
      const followed = await resumePendingTurn({ threadId, context, learn, refs });
      if (followed) return followed;
    } else {
      await context.stores.threads.setPendingHop(threadId, null);
    }
    if (userEscalates(content)) {
      return context.stores.messages.append({
        threadId,
        role: 'system',
        content: formatEscalatedBallNote('你', '收回了下一棒'),
        status: 'completed',
      });
    }
  }

  const cleanMessage = stripMentions(content, catalog).trim();
  if (!cleanMessage) {
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: '⚠️ 没有可执行的任务文本',
      status: 'completed',
    });
  }

  const targetResults = await Promise.allSettled(
    targets.map(async (target) => {
      const visited = new Set<AgentId>();
      return runSegment(
        context,
        thread,
        { agentId: target, text: cleanMessage },
        refs,
        visited,
        writeQueue,
        catalog,
        team,
        maxDepth,
      );
    }),
  );

  const fulfilled = targetResults.find(
    (r): r is PromiseFulfilledResult<SegmentRunResult> =>
      r.status === 'fulfilled',
  );
  const lastResult = fulfilled?.value ?? null;
  for (const result of targetResults) {
    if (result.status === 'rejected') {
      turnLog('segment fail', { thread: threadId, error: clip(String(result.reason), 120) });
    }
  }
  if (!lastResult) {
    const rejected = targetResults.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (rejected) throw rejected.reason;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: '⚠️ 没有可执行的任务文本',
      status: 'completed',
    });
  }

  return settleTurn({
    threadId,
    context,
    thread,
    learn,
    lastResult,
    writeQueue,
    catalog,
    team,
    refs,
  });
}

/** 不追加用户消息,取出 pending 跑下一跳。没有 pending 则 null。 */
export async function resumePendingTurn(input: {
  threadId: string;
  context: TurnContext;
  learn?: ReturnType<typeof parseLearnCommand>;
  refs?: EvidenceEntry[];
}): Promise<Message | null> {
  const { threadId, context } = input;
  const thread = await context.stores.threads.get(threadId);
  if (!thread?.pendingHop || thread.pendingHop.holdCommand) return null;
  thread.workdir = resolve(thread.workdir);
  const pending = thread.pendingHop;
  const roster = await loadRoster(context);
  turnLog('pending follow', { thread: threadId, to: pending.to });

  let lastResult: SegmentRunResult | undefined;
  try {
    const history = await context.stores.messages.list(threadId);
    const forHop = history.filter((m) => m.role === 'assistant' && m.hopId === pending.id);
    // 补问会让同一棒产出两条消息:认最后一条完成的才是这一跳的结果
    const completed = forHop.filter((m) => m.status === 'completed').at(-1);
    const streaming = forHop.filter((m) => m.status === 'streaming');
    if (completed) {
      lastResult = {
        lastAssistant: completed,
        lastOutput: {
          sessionId: completed.sessionId ?? '',
          content: completed.content,
          status: completed.status,
          usage: completed.usage,
          error: completed.error,
        },
        visited: new Set<AgentId>([...pending.visited, pending.to]),
        firstAgent: pending.firstAgent,
      };
    } else {
      for (const stale of streaming) {
        await context.stores.messages.patch(threadId, stale.id, {
          status: 'failed',
          error: formatHopInterruptedNote(),
        });
      }
      lastResult = await runSegment(
        context,
        thread,
        { agentId: pending.to, text: pending.goal },
        input.refs ?? [],
        new Set<AgentId>(),
        createWriteQueue(),
        roster.catalog,
        roster.team,
        roster.maxDepth,
        pending,
      );
    }
    return await settleTurn({
      threadId,
      context,
      thread,
      learn: input.learn,
      lastResult,
      writeQueue: createWriteQueue(),
      catalog: roster.catalog,
      team: roster.team,
      refs: input.refs ?? [],
    });
  } finally {
    // 有产出才清:崩在模型里(没 lastResult)留下给开机重跑;失败但已落库的清掉,避免开机死循环
    if (lastResult) {
      await context.stores.threads.clearPendingHopIfSame(threadId, pending.id);
    }
  }
}

/** 平台自己把 pending 跟完,直到没下一跳、升级、或链深用尽。 */
export async function followPendingChain(input: {
  threadId: string;
  context: TurnContext;
}): Promise<void> {
  const max = input.context.a2aMaxDepth ?? MAX_A2A_DEPTH;
  await finishHoldCommandThenWake(input);
  for (let i = 0; i < max; i++) {
    if (input.context.signal?.aborted) return;
    const ran = await resumePendingTurn(input);
    if (!ran) return;
  }
}
