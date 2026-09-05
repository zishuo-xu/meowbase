import { randomUUID } from 'node:crypto';
import {
  buildSystemPrompt,
  displayName,
  findInlineA2AMentions,
  findInlineEscalateTokens,
  formatA2AHandoffPrompt,
  formatA2ARelayNote,
  formatAbortedBallNote,
  formatDroppedBallNote,
  formatEscalatedBallNote,
  formatExitNudgeNote,
  formatExitNudgePrompt,
  formatFailedBallNote,
  formatHoldBallNote,
  hasExplicitReviewVerdict,
  isVoidHandoff,
  matchSkills,
  parseA2AHandoff,
  parseHoldCommand,
  parseHoldExit,
  shouldNudgeExit,
  toEvidenceScopeThread,
  authorizeHoldCommand,
  type A2AStopKind,
  type HoldCommandDenyReason,
  type PendingHop,
} from '@meowbase/shared';
import type {
  AgentId,
  EvidenceEntry,
  MentionCatalog,
  Message,
  TeamMember,
} from '@meowbase/shared';
import type { AgentTurnOutput } from '../../providers/types.js';
import { clip, turnLog } from '../../services/turn-log.js';
import { runAgentTurn } from './agent-hop.js';
import {
  countCommitsBetween,
  describeGitMoves,
  snapshotGitState,
  type GitOverstep,
  type GitStateSnapshot,
} from '../../services/git.js';
import {
  formatPrCiNote,
  formatPrLookupFailedNote,
  formatPrMergedNote,
  formatPrOpenedNote,
  formatPrReviewNote,
  isPrMerged,
  listPrChecks,
  listPrReviews,
  lookupPr,
  selectUnseenPrChecks,
  selectUnseenPrReviews,
  type PrCheckItem,
  type PrCheckListResult,
  type PrCheckRef,
  type PrMergeStop,
  type PrReviewItem,
  type PrReviewListResult,
  type PrReviewRef,
  type PrSnapshot,
} from '../../services/pr.js';
import { isReviewerRole, listHandoffFiles, overlayProfile } from './context.js';
import type { SegmentRunResult, ThreadRuntime, TurnContext, WriteQueue } from './types.js';

async function recordGitMove(input: {
  thread: ThreadRuntime;
  context: TurnContext;
  writeQueue: WriteQueue;
  before: GitStateSnapshot | null;
  agentName: string;
}): Promise<GitOverstep[]> {
  if (!input.thread.repo || !input.before) return [];
  try {
    const after = await snapshotGitState(input.thread.workdir, {
      baseBranch: input.thread.repo.baseBranch,
    });
    const commitsSinceBefore = await countCommitsBetween(
      input.thread.workdir,
      input.before.headSha,
      after.headSha,
    );
    const classified = describeGitMoves({
      before: input.before,
      after,
      commitsSinceBefore,
      agentName: input.agentName,
      baseBranch: input.thread.repo.baseBranch,
      allowRemote: input.thread.repo.allowRemote === true,
    });
    if (classified.notes.length > 0) {
      await input.writeQueue(() =>
        input.context.stores.messages.append({
          threadId: input.thread.id,
          role: 'system',
          content: classified.notes.join('\n'),
          status: 'completed',
          systemKind: 'git-move',
        }),
      );
    }
    return classified.oversteps;
  } catch (err) {
    turnLog('git-move fail', {
      thread: input.thread.id,
      error: clip(String(err), 120),
    });
    return [];
  }
}

async function recordPrState(input: {
  thread: ThreadRuntime;
  context: TurnContext;
  writeQueue: WriteQueue;
  agentName: string;
  onOpenPr?: (pr: PrSnapshot) => Promise<void>;
}): Promise<PrMergeStop | undefined> {
  if (!input.thread.repo) return undefined;
  if (!input.thread.repo.allowRemote) return undefined;
  const branch = input.thread.repo.branch;
  const lookup = input.context.lookupPr ?? lookupPr;
  let result;
  try {
    result = await lookup({
      workdir: input.thread.workdir,
      head: branch,
    });
  } catch (err) {
    turnLog('pr lookup fail', {
      thread: input.thread.id,
      error: clip(String(err), 120),
    });
    result = { ok: false as const, reason: clip(String(err), 80) };
  }
  if (!result.ok) {
    const reason = result.reason;
    await input.writeQueue(() =>
      input.context.stores.messages.append({
        threadId: input.thread.id,
        role: 'system',
        content: formatPrLookupFailedNote(reason),
        status: 'completed',
        systemKind: 'notice',
      }),
    );
    return undefined;
  }
  const pr = result.pr;
  if (!pr) return undefined;

  const prior = await input.context.stores.messages.list(input.thread.id);
  const samePr = (kind: 'pr-opened' | 'pr-merged', seen: PrSnapshot) =>
    prior.some(
      (m) =>
        m.role === 'system' &&
        m.systemKind === kind &&
        m.systemMeta?.prNumber === seen.number,
    );

  if (isPrMerged(pr)) {
    if (samePr('pr-merged', pr)) return undefined;
    return {
      number: pr.number,
      url: pr.url,
      headRefOid: pr.headRefOid,
      note: formatPrMergedNote({ number: pr.number, url: pr.url }),
    };
  }
  // OPEN 才查评论:CLOSED 不查;merged 已由上面的分支收敛
  if (pr.state === 'OPEN' && input.onOpenPr) await input.onOpenPr(pr);
  if (samePr('pr-opened', pr)) return undefined;
  await input.writeQueue(() =>
    input.context.stores.messages.append({
      threadId: input.thread.id,
      role: 'system',
      content: formatPrOpenedNote({
        agentName: input.agentName,
        branch,
        number: pr.number,
        url: pr.url,
      }),
      status: 'completed',
      systemKind: 'pr-opened',
      systemMeta: {
        prNumber: pr.number,
        prUrl: pr.url,
        headRefOid: pr.headRefOid,
      },
    }),
  );
  return undefined;
}

/** PR 评论回流:投新评论进时间线,指纹只在 append 成功后推进 */
async function syncPrReviews(input: {
  thread: ThreadRuntime;
  context: TurnContext;
  writeQueue: WriteQueue;
  pr: PrSnapshot;
}): Promise<PrReviewItem[]> {
  if (input.pr.state !== 'OPEN') return []; // 双保险:onOpenPr 只在 OPEN 时挂
  const list = input.context.listPrReviews ?? listPrReviews;
  let result: PrReviewListResult;
  try {
    result = await list({ workdir: input.thread.workdir, number: input.pr.number });
  } catch (err) {
    result = { ok: false as const, reason: clip(String(err), 80) };
  }
  if (!result.ok) {
    const reason = result.reason;
    await input.writeQueue(() =>
      input.context.stores.messages.append({
        threadId: input.thread.id,
        role: 'system',
        content: formatPrLookupFailedNote(reason),
        status: 'completed',
        systemKind: 'notice',
      }),
    );
    return [];
  }
  // 现查指纹:turn 开始时的 thread 是死快照(redis 的 get 每次新建对象),
  // 同一 turn 多段共享它,读快照会重投
  const seen =
    (await input.context.stores.threads.get(input.thread.id))?.repo?.seenPrCommentIds ?? [];
  const fresh = selectUnseenPrReviews(result.items, seen);
  if (fresh.length === 0) return [];
  const delivered: string[] = [];
  const persisted = [...seen];
  for (const item of fresh) {
    // append 成功才记指纹;抛错就让异常冒上去中断(writeQueue 串行),之前投成功的不丢
    await input.writeQueue(() =>
      input.context.stores.messages.append({
        threadId: input.thread.id,
        role: 'system',
        content: formatPrReviewNote({
          author: item.author,
          body: item.body,
          number: input.pr.number,
          url: item.htmlUrl ?? input.pr.url,
        }),
        status: 'completed',
        systemKind: 'pr-review',
        systemMeta: { prNumber: input.pr.number, prUrl: input.pr.url },
      }),
    );
    delivered.push(item.id);
    persisted.push(item.id);
    // 每条投成功立即推进指纹:中途抛错,已投的下轮也不会重投
    await input.context.stores.threads.setSeenPrCommentIds(input.thread.id, [...persisted]);
  }
  return fresh.filter((i) => delivered.includes(i.id));
}

async function syncPrChecks(input: {
  thread: ThreadRuntime;
  context: TurnContext;
  writeQueue: WriteQueue;
  pr: PrSnapshot;
}): Promise<PrCheckItem[]> {
  if (input.pr.state !== 'OPEN') return [];
  const list = input.context.listPrChecks ?? listPrChecks;
  let result: PrCheckListResult;
  try {
    result = await list({ workdir: input.thread.workdir, number: input.pr.number });
  } catch (err) {
    result = { ok: false as const, reason: clip(String(err), 80) };
  }
  if (!result.ok) {
    const reason = result.reason;
    await input.writeQueue(() =>
      input.context.stores.messages.append({
        threadId: input.thread.id,
        role: 'system',
        content: formatPrLookupFailedNote(reason),
        status: 'completed',
        systemKind: 'notice',
      }),
    );
    return [];
  }
  const seen =
    (await input.context.stores.threads.get(input.thread.id))?.repo?.seenPrCheckIds ?? [];
  const fresh = selectUnseenPrChecks(result.items, seen);
  if (fresh.length === 0) return [];
  const delivered: string[] = [];
  const persisted = [...seen];
  for (const item of fresh) {
    await input.writeQueue(() =>
      input.context.stores.messages.append({
        threadId: input.thread.id,
        role: 'system',
        content: formatPrCiNote({
          name: item.name,
          conclusion: item.conclusion,
          number: input.pr.number,
          url: item.link ?? input.pr.url,
        }),
        status: 'completed',
        systemKind: 'pr-ci',
        systemMeta: { prNumber: input.pr.number, prUrl: input.pr.url },
      }),
    );
    delivered.push(item.id);
    persisted.push(item.id);
    await input.context.stores.threads.setSeenPrCheckIds(input.thread.id, [...persisted]);
  }
  return fresh.filter((i) => delivered.includes(i.id));
}

async function rememberHoldCommand(input: {
  thread: { id: string };
  context: TurnContext;
  writeQueue: WriteQueue;
  currentAgent: AgentId;
  prevContent: string;
  segmentText: string;
  visited: Set<AgentId>;
  firstAgent: AgentId;
  hop: number;
}): Promise<void> {
  const command = parseHoldCommand(input.prevContent);
  if (!command) return;
  const pendingHop: PendingHop = {
    id: randomUUID(),
    to: input.currentAgent,
    from: input.currentAgent,
    task: command,
    goal: input.segmentText,
    previousOutput: input.prevContent,
    visited: [...input.visited],
    firstAgent: input.firstAgent,
    hop: input.hop,
    holdCommand: command,
  };
  await input.writeQueue(() => input.context.stores.threads.setPendingHop(input.thread.id, pendingHop));
  turnLog('hold command', { thread: input.thread.id, from: input.currentAgent, command: clip(command, 60) });
}

/** 执行一个 @mention 段:单轮 + A2A 接力链 */
export async function runSegment(
  context: TurnContext,
  thread: ThreadRuntime,
  segment: { agentId: AgentId; text: string },
  refs: EvidenceEntry[],
  visited: Set<AgentId>,
  writeQueue: WriteQueue,
  catalog: MentionCatalog,
  team: readonly TeamMember[],
  maxDepth: number,
  resume?: PendingHop,
): Promise<SegmentRunResult> {
  let lastAssistant: Message | null = null;
  let lastOutput: AgentTurnOutput | null = null;
  let currentAgent: AgentId = resume?.to ?? segment.agentId;
  let currentTask = resume?.task ?? segment.text;
  let prevContent = resume?.previousOutput ?? '';
  let fromAgent: AgentId | undefined =
    resume && resume.from === resume.to ? undefined : resume?.from;
  let firstAgent: AgentId = resume?.firstAgent ?? segment.agentId;
  let stop: {
    kind: A2AStopKind;
    blockedTarget?: AgentId;
    hadInlineHint?: boolean;
    escalateTask?: string;
    holdReason?: string;
    handoffTask?: string;
    deniedCommand?: string;
    denyReason?: HoldCommandDenyReason;
  } | undefined;
  const oversteps: GitOverstep[] = [];
  let mergedPr: PrMergeStop | undefined;
  const prReviews: PrReviewRef[] = [];
  const prChecks: PrCheckRef[] = [];
  if (resume) {
    for (const id of resume.visited) visited.add(id);
  }

  for (let hop = resume?.hop ?? 0; hop < maxDepth; hop++) {
    if (!context.registry.get(currentAgent)) {
      throw new Error(`没有可用的 agent: ${currentAgent}`);
    }
    visited.add(currentAgent);

    const stored = (await context.stores.profiles.get(currentAgent)) ?? undefined;
    const spec = context.agents?.find((a) => a.id === currentAgent);
    const profile = overlayProfile(stored, spec);
    const matchedSkills = await matchSkills(currentTask, await context.stores.skills.list());
    const evidenceThreads = (await context.stores.threads.list()).map(toEvidenceScopeThread);
    const systemPrompt = buildSystemPrompt({
      profile,
      team,
      skills: matchedSkills,
      evidenceRefs: refs,
      evidenceThreads,
      workdir: thread.workdir,
      repo: thread.repo,
    });
    const prompt = fromAgent
      ? formatA2AHandoffPrompt(
          displayName(fromAgent, catalog),
          fromAgent,
          prevContent,
          currentTask,
          {
            goal: segment.text,
            files: await listHandoffFiles(thread.workdir, thread.repo),
            closeout: isReviewerRole(team.find((m) => m.agentId === currentAgent)?.role)
              ? 'reviewer'
              : 'default',
            workdir: thread.workdir,
          },
        )
      : currentTask;

    let before: GitStateSnapshot | null = null;
    if (thread.repo) {
      try {
        before = await snapshotGitState(thread.workdir, { baseBranch: thread.repo.baseBranch });
      } catch (err) {
        turnLog('git-move fail', { thread: thread.id, error: clip(String(err), 120) });
      }
    }
    let recordedHop = false;
    const captureAfterHop = async (): Promise<boolean> => {
      if (recordedHop) return oversteps.length > 0 || Boolean(mergedPr);
      recordedHop = true;
      const agentName = displayName(currentAgent, catalog);
      const found = await recordGitMove({
        thread,
        context,
        writeQueue,
        before,
        agentName,
      });
      oversteps.push(...found);
      const foundMerge = await recordPrState({
        thread,
        context,
        writeQueue,
        agentName,
        onOpenPr: async (pr) => {
          const delivered = await syncPrReviews({ thread, context, writeQueue, pr });
          for (const item of delivered) {
            prReviews.push({ item, prNumber: pr.number, prUrl: pr.url });
          }
          const checks = await syncPrChecks({ thread, context, writeQueue, pr });
          for (const item of checks) {
            prChecks.push({ item, prNumber: pr.number, prUrl: pr.url });
          }
        },
      });
      if (foundMerge) mergedPr = foundMerge;
      return found.length > 0 || Boolean(foundMerge);
    };
    try {
    const hopResult = await runAgentTurn(
      context,
      thread,
      currentAgent,
      prompt,
      systemPrompt,
      writeQueue,
      resume?.id,
    );
    lastAssistant = hopResult.assistant;
    lastOutput = hopResult.output;
    prevContent = hopResult.content;

    const applyHoldExit = async (holdReason: string): Promise<void> => {
      const command = parseHoldCommand(prevContent);
      if (command) {
        const decision = authorizeHoldCommand(command, context.holdCommands);
        if (!decision.ok) {
          turnLog('a2a stop', {
            thread: thread.id,
            from: currentAgent,
            reason: 'denied-command',
          });
          stop = {
            kind: 'denied-command',
            deniedCommand: command,
            denyReason: decision.reason,
          };
          return;
        }
      }
      turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'held' });
      stop = { kind: 'held', holdReason };
      await rememberHoldCommand({
        thread,
        context,
        writeQueue,
        currentAgent,
        prevContent,
        segmentText: segment.text,
        visited,
        firstAgent,
        hop,
      });
    };

    // A2A 接力:回复行首 @ 其他角色 → 交接;已出场/不可用/无任务则停
    if (context.signal?.aborted || lastOutput.status !== 'completed') break;
    let handoff = parseA2AHandoff(prevContent, currentAgent, catalog);
    if (!handoff) {
      const holdReason = parseHoldExit(prevContent);
      if (holdReason) {
        await applyHoldExit(holdReason);
        break;
      }
      const inline = findInlineA2AMentions(prevContent, currentAgent, catalog);
      const inlineHuman = findInlineEscalateTokens(prevContent);
      const labels = [
        ...inline.map((id) => `@${displayName(id, catalog)}`),
        ...inlineHuman.map((token) => `@${token}`),
      ];
      const member = team.find((m) => m.agentId === currentAgent);
      const isReviewer = isReviewerRole(member?.role);
      if (
        shouldNudgeExit({
          wasRelay: Boolean(fromAgent),
          hadInlineHint: labels.length > 0,
          isReviewer,
          hasExplicitVerdict: hasExplicitReviewVerdict(prevContent),
          hasDiff: (await listHandoffFiles(thread.workdir, thread.repo)).length > 0,
          hasHold: Boolean(holdReason),
        })
      ) {
        const handoffName = member?.handoffTo
          ? displayName(member.handoffTo, catalog)
          : undefined;
        await writeQueue(() =>
          context.stores.messages.append({
            threadId: thread.id,
            role: 'system',
            content: formatExitNudgeNote(displayName(currentAgent, catalog)),
            status: 'completed',
            systemKind: 'exit-nudge',
          }),
        );
        turnLog('a2a nudge', { thread: thread.id, from: currentAgent });
        const nudged = await runAgentTurn(
          context,
          thread,
          currentAgent,
          formatExitNudgePrompt({
            previousOutput: prevContent,
            handoffName,
            isReviewer,
          }),
          systemPrompt,
          writeQueue,
        );
        lastAssistant = nudged.assistant;
        lastOutput = nudged.output;
        prevContent = nudged.content;
        if (context.signal?.aborted || lastOutput.status !== 'completed') break;
        handoff = parseA2AHandoff(prevContent, currentAgent, catalog);
      }
    }
    if (handoff?.target === 'human') {
      turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'escalated' });
      stop = { kind: 'escalated', escalateTask: handoff.task };
      break;
    }
    if (handoff && isReviewerRole(team.find((m) => m.agentId === currentAgent)?.role)) {
      turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'reviewer-closeout' });
      stop = { kind: 'reviewer-closeout' };
      break;
    }
    if (!handoff) {
      const holdReason = parseHoldExit(prevContent);
      if (holdReason) {
        await applyHoldExit(holdReason);
        break;
      }
      turnLog('a2a stop', { thread: thread.id, from: currentAgent });
      const inline = findInlineA2AMentions(prevContent, currentAgent, catalog);
      const inlineHuman = findInlineEscalateTokens(prevContent);
      const labels = [
        ...inline.map((id) => `@${displayName(id, catalog)}`),
        ...inlineHuman.map((token) => `@${token}`),
      ];
      if (labels.length > 0) {
        await writeQueue(() =>
          context.stores.messages.append({
            threadId: thread.id,
            role: 'system',
            content: `💡 ${labels.join('、')} 写在句中不会交接 — 请另起一行、行首写 @名字 再跟任务`,
            status: 'completed',
            systemKind: 'routing-hint',
          }),
        );
      }
      stop = { kind: 'no-handoff', hadInlineHint: labels.length > 0 };
      break;
    }
    if (visited.has(handoff.target) || !context.registry.get(handoff.target)) {
      stop = { kind: 'blocked', blockedTarget: handoff.target };
      break;
    }
    if (hop + 1 >= maxDepth) {
      await writeQueue(() =>
        context.stores.messages.append({
          threadId: thread.id,
          role: 'system',
          content: `⚠️ 接力链已达上限(${maxDepth}),停止交接`,
          status: 'completed',
          systemKind: 'notice',
        }),
      );
      break;
    }
    const relayFiles = await listHandoffFiles(thread.workdir, thread.repo);
    const relayTarget: AgentId = handoff.target;
    if (isVoidHandoff({ changedFiles: relayFiles, reply: prevContent })) {
      stop = { kind: 'void', blockedTarget: relayTarget, handoffTask: handoff.task };
      break;
    }
    if (await captureAfterHop()) break;
    const pendingHop: PendingHop = {
      id: randomUUID(),
      to: relayTarget,
      from: currentAgent,
      task: handoff.task,
      goal: segment.text,
      previousOutput: prevContent,
      visited: [...visited],
      firstAgent,
      hop: hop + 1,
    };
    await writeQueue(async () => {
      await context.stores.threads.setPendingHop(thread.id, pendingHop);
      await context.stores.messages.append({
        threadId: thread.id,
        role: 'system',
        content: formatA2ARelayNote({
          fromName: displayName(currentAgent, catalog),
          toName: displayName(relayTarget, catalog),
          goal: segment.text,
          files: relayFiles,
          task: handoff.task,
          previousOutput: prevContent,
        }),
        status: 'completed',
        systemKind: 'relay',
        systemMeta: { from: currentAgent, to: relayTarget },
      });
    });
    turnLog('a2a defer', {
      thread: thread.id,
      from: currentAgent,
      to: relayTarget,
      task: clip(handoff.task, 60),
    });
    break;
    } finally {
      await captureAfterHop();
    }
  }

  if (!lastAssistant || !lastOutput) throw new Error('执行失败:未产生任何输出');
  if (context.signal?.aborted || lastOutput.error === '已中止') {
    turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'aborted' });
    await writeQueue(() =>
      context.stores.messages.append({
        threadId: thread.id,
        role: 'system',
        content: formatAbortedBallNote(),
        status: 'completed',
        systemKind: 'aborted',
      }),
    );
  } else if (lastOutput.status === 'failed' || lastOutput.status === 'terminated') {
    turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'failed' });
    await writeQueue(() =>
      context.stores.messages.append({
        threadId: thread.id,
        role: 'system',
        content: formatFailedBallNote(),
        status: 'completed',
        systemKind: 'failed',
      }),
    );
  } else if (lastOutput.status === 'completed' && stop) {
    const note =
      stop.kind === 'escalated'
        ? formatEscalatedBallNote(displayName(currentAgent, catalog), stop.escalateTask)
        : stop.kind === 'held'
          ? formatHoldBallNote(displayName(currentAgent, catalog), stop.holdReason)
        : formatDroppedBallNote({
            stop: stop.kind,
            lastContent: prevContent,
            speakerName: displayName(currentAgent, catalog),
            role: team.find((m) => m.agentId === currentAgent)?.role,
            wasRelay: Boolean(fromAgent),
            hadInlineHint: stop.hadInlineHint,
            blockedTargetName: stop.blockedTarget
              ? displayName(stop.blockedTarget, catalog)
              : undefined,
            handoffTask: stop.handoffTask,
            deniedCommand: stop.deniedCommand,
            denyReason: stop.denyReason,
          });
    if (note) {
      if (stop.kind !== 'escalated' && stop.kind !== 'held') {
        turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'dropped-ball' });
      }
      const systemKind =
        stop.kind === 'escalated' ? 'escalated' : stop.kind === 'held' ? 'hold' : 'dropped';
      await writeQueue(() =>
        context.stores.messages.append({
          threadId: thread.id,
          role: 'system',
          content: note,
          status: 'completed',
          systemKind,
        }),
      );
    }
  }
  return { lastAssistant, lastOutput, visited, firstAgent, oversteps, mergedPr, prReviews, prChecks };
}
