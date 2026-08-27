import { resolve } from 'node:path';
import { killHoldCommand } from '../services/hold-command.js';
import {
  displayName,
  formatEscalatedBallNote,
  formatHopInterruptedNote,
  isPlaceholderTitle,
  shouldResumePending,
  parseEvidenceRefs,
  parseLearnCommand,
  filterEvidenceByRecallScope,
  matchEvidence,
  toEvidenceScopeThread,
  wantsEvidenceRecall,
  resolveTurnTargets,
  titleFromUserMessage,
  stripMentions,
} from '@meowbase/shared';
import type {
  AgentId,
  EvidenceEntry,
  Message,
  PendingHop,
} from '@meowbase/shared';
import { clip, turnLog } from '../services/turn-log.js';
import { safeAppendAudit } from '../stores/audit-log.js';
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
    const threads = await context.stores.threads.list();
    const scoped = filterEvidenceByRecallScope(
      await context.stores.evidence.list(),
      { threadId, repoPath: thread.repo?.path },
      threads.map(toEvidenceScopeThread),
    );
    const recalled = matchEvidence(content, scoped);
    for (const entry of recalled) {
      if (!refs.some((item) => item.id === entry.id)) refs.push(entry);
    }
  }

  // 多 @ 同题群发、顺序执行:各占一行的行首 @ 才是目标;同一正文发给每个目标;一只跑完再跑下一只;失败隔离;只跟第一个交出来的棒
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
        systemKind: 'escalated',
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
      systemKind: 'notice',
    });
  }

  const targetResults: PromiseSettledResult<SegmentRunResult>[] = [];
  let keptHop: PendingHop | null = null;
  for (const target of targets) {
    try {
      const visited = new Set<AgentId>();
      const value = await runSegment(
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
      targetResults.push({ status: 'fulfilled', value });
    } catch (reason) {
      targetResults.push({ status: 'rejected', reason });
      turnLog('segment fail', { thread: threadId, error: clip(String(reason), 120) });
    }
    const currentHop = (await context.stores.threads.get(threadId))?.pendingHop ?? null;
    if (!currentHop) continue;
    if (!keptHop) {
      keptHop = currentHop;
      continue;
    }
    if (currentHop.id === keptHop.id) continue;
    const dropped = currentHop;
    const restore = keptHop;
    await writeQueue(async () => {
      await context.stores.threads.setPendingHop(threadId, restore);
      await context.stores.messages.append({
        threadId,
        role: 'system',
        content: `这条线程一次只跟一棒。${displayName(dropped.from, catalog)} 交给 ${displayName(dropped.to, catalog)} 的这一棒得人来接。`,
        status: 'completed',
        systemKind: 'notice',
      });
    });
  }

  let lastResult: SegmentRunResult | null = null;
  for (const result of targetResults) {
    if (result.status === 'fulfilled') lastResult = result.value;
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
      systemKind: 'notice',
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
      if (streaming.length > 0) {
        await safeAppendAudit(context.stores.audit, {
          threadId,
          actor: 'platform',
          action: 'hop-rerun',
          subject: '半截消息标失败后重跑',
          meta: { hopId: pending.id, messageId: streaming[0]?.id },
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
