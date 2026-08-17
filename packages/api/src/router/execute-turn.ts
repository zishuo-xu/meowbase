import { resolve } from 'node:path';
import {
  buildMentionCatalog,
  buildSystemPrompt,
  DEFAULT_ROSTER,
  displayName,
  findInlineA2AMentions,
  formatA2AHandoffPrompt,
  formatAbortedBallNote,
  formatDroppedBallNote,
  formatFailedBallNote,
  matchSkills,
  parseA2AHandoff,
  parseApproveCommand,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
  parseRejectCommand,
  resolveTurnTargets,
  parseReviewVerdict,
  allowsAutoApprove,
  gateReviewVerdict,
  type A2AStopKind,
  selectReviewer,
  stripMentions,
} from '@meowbase/shared';
import type {
  AgentId,
  AgentProfile,
  EvidenceEntry,
  MentionCatalog,
  Message,
  Skill,
  TeamMember,
  ToolActivity,
} from '@meowbase/shared';
import type { AgentRegistry, AgentService, AgentTurnOutput } from '../providers/types.js';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from '../stores/ports.js';
import { gitAddAll, gitChangedPaths, gitCommit, gitDiffHead, sweepStrayFiles } from '../services/git.js';
import { clip, turnLog } from '../services/turn-log.js';
import type { AgentSpec } from '../config.js';
import { finalizeActivities, upsertToolActivity } from '../providers/tool-activity.js';

/** A2A 接力链深上限(借鉴 clowder F046):链上最多出现 MAX_A2A_DEPTH 个 agent */
export const MAX_A2A_DEPTH = 3;
/** 审查需修改时,最多打回写手这么多轮;仍不通过才把卡片交给人 */
export const MAX_REVIEW_FIX_ROUNDS = 2;

type ThreadRuntime = {
  id: string;
  workdir: string;
  sessions: Partial<Record<AgentId, string>>;
  primaryAgentId: AgentId;
};

export interface TurnContext {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
    skills: SkillStore;
    approvals: ApprovalStore;
  };
  registry: AgentRegistry;
  /** A2A 接力链深上限,默认 MAX_A2A_DEPTH */
  a2aMaxDepth?: number;
  /** 团队名册(来自 meowbase.config.json);有则用其别名做 @ 解析 */
  agents?: AgentSpec[];
  onIncrement?: (
    threadId: string,
    messageId: string,
    delta: string,
    agentId?: AgentId,
  ) => void;
  onActivity?: (
    threadId: string,
    messageId: string,
    activity: ToolActivity,
    agentId?: AgentId,
  ) => void;
  onStart?: (threadId: string, messageId: string, agentId?: AgentId) => void;
  onThinking?: (threadId: string, messageId: string, delta: string, agentId?: AgentId) => void;
  signal?: AbortSignal;
}

interface SegmentRunResult {
  lastAssistant: Message;
  lastOutput: AgentTurnOutput;
  visited: Set<AgentId>;
  firstAgent: AgentId;
}

/** 串行化存储写操作:并行组并发 append/patch 时避免 Redis lost-update */
type WriteQueue = <T>(fn: () => Promise<T>) => Promise<T>;

function overlayProfile(
  stored: AgentProfile | undefined,
  spec: AgentSpec | undefined,
): AgentProfile | undefined {
  if (!spec) return stored;
  return {
    agentId: spec.id,
    name: spec.name,
    personality: spec.personality,
    role: spec.role,
    expertise: spec.expertise,
    autoApprove: stored?.autoApprove,
    createdAt: stored?.createdAt ?? new Date().toISOString(),
  };
}

function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

export async function executeTurn(input: {
  threadId: string;
  content: string;
  context: TurnContext;
}): Promise<Message> {
  const { threadId, content, context } = input;

  const thread = await context.stores.threads.get(threadId);
  if (!thread) throw new Error(`线程不存在: ${threadId}`);

  await context.stores.messages.append({
    threadId,
    role: 'user',
    content,
    status: 'completed',
  });

  // 系统命令分支:纯系统操作,不路由给 agent
  const confirm = parseConfirmCommand(content);
  if (confirm) {
    turnLog('confirm', { thread: threadId, id: confirm.id });
    const entry = await context.stores.evidence.confirm(confirm.id);
    const reply = entry
      ? `✅ 已沉淀:${entry.title}`
      : `⚠️ 找不到可确认的证据:${confirm.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
    });
  }

  const approve = parseApproveCommand(content);
  if (approve) {
    turnLog('approve', { thread: threadId, id: approve.id });
    const card = await context.stores.approvals.approve(approve.id);
    if (card) {
      try {
        await gitCommit(thread.workdir, `approve ${card.id}`);
      } catch {
        // git 提交失败不阻塞;批准决策本身已生效
      }
      await context.stores.approvals.markApplied(card.id);
    }
    const reply = card
      ? `✅ 已批准并落地:${card.id}`
      : `⚠️ 找不到可批准的卡片:${approve.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
    });
  }

  const reject = parseRejectCommand(content);
  if (reject) {
    turnLog('reject', { thread: threadId, id: reject.id, reason: clip(reject.reason, 40) });
    const card = await context.stores.approvals.reject(reject.id, reject.reason);
    const reply = card
      ? `⛔ 已打回:${card.id} 理由:${reject.reason || '(未填)'}`
      : `⚠️ 找不到可打回的卡片:${reject.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
    });
  }

  const learn = parseLearnCommand(content);
  const refIds = parseEvidenceRefs(content);
  const refs: EvidenceEntry[] = [];
  for (const id of refIds) {
    const entry = await context.stores.evidence.get(id);
    if (entry?.status === 'confirmed') refs.push(entry);
  }

  // 多 @ 同题并行(对齐 clowder):每个目标收到同一消息;A2A 接力各自串行;失败隔离
  const profiles = await context.stores.profiles.list();
  const members =
    context.agents?.map((a) => ({
      agentId: a.id,
      name: a.name,
      aliases: a.aliases,
    })) ?? profiles.map((p) => ({ agentId: p.agentId, name: p.name }));
  const catalog = buildMentionCatalog(members);
  const team: TeamMember[] =
    context.agents && context.agents.length > 0
      ? context.agents.map((a) => ({
          agentId: a.id,
          name: a.name,
          role: a.role,
          handoffTo: a.handoffTo,
          handoff: a.handoff,
          doneWhen: a.doneWhen,
        }))
      : profiles.length > 0
        ? profiles.map((p) => ({ agentId: p.agentId, name: p.name, role: p.role }))
        : [...DEFAULT_ROSTER];
  const maxDepth = context.a2aMaxDepth ?? MAX_A2A_DEPTH;
  const history = await context.stores.messages.list(threadId);
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
  const cleanMessage = stripMentions(content, catalog).trim();
  if (!cleanMessage) {
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: '⚠️ 没有可执行的任务文本',
      status: 'completed',
    });
  }

  const writeQueue = createWriteQueue();
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

  const { lastAssistant, lastOutput, visited, firstAgent: chainFirstAgent } = lastResult;

  // #learn 沉淀:仅 completed 时生成 draft + 建议消息(内容取链上最终输出)
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
    });
  }

  // 审批流:有 diff → 可见互审(需修改则打回写手再审) → 通过或轮次用尽才出卡片
  if (lastOutput.status === 'completed') {
    try {
      await gitAddAll(thread.workdir);
      const diff = await gitDiffHead(thread.workdir);
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

/** 执行一个 @mention 段:单轮 + A2A 接力链 */
async function runSegment(
  context: TurnContext,
  thread: { id: string; workdir: string; sessions: Partial<Record<AgentId, string>>; primaryAgentId: AgentId },
  segment: { agentId: AgentId; text: string },
  refs: EvidenceEntry[],
  visited: Set<AgentId>,
  writeQueue: WriteQueue,
  catalog: MentionCatalog,
  team: readonly TeamMember[],
  maxDepth: number,
): Promise<SegmentRunResult> {
  let lastAssistant: Message | null = null;
  let lastOutput: AgentTurnOutput | null = null;
  let currentAgent: AgentId = segment.agentId;
  let currentTask = segment.text;
  let prevContent = '';
  let fromAgent: AgentId | undefined;
  let firstAgent: AgentId = segment.agentId;
  let stop: { kind: A2AStopKind; blockedTarget?: AgentId; hadInlineHint?: boolean } | undefined;

  for (let hop = 0; hop < maxDepth; hop++) {
    if (!context.registry.get(currentAgent)) {
      throw new Error(`没有可用的 agent: ${currentAgent}`);
    }
    visited.add(currentAgent);

    const stored = (await context.stores.profiles.get(currentAgent)) ?? undefined;
    const spec = context.agents?.find((a) => a.id === currentAgent);
    const profile = overlayProfile(stored, spec);
    const matchedSkills = await matchSkills(currentTask, await context.stores.skills.list());
    const systemPrompt = buildSystemPrompt({
      profile,
      team,
      skills: matchedSkills,
      evidenceRefs: refs,
    });
    const prompt = fromAgent
      ? formatA2AHandoffPrompt(
          displayName(fromAgent, catalog),
          fromAgent,
          prevContent,
          currentTask,
          {
            goal: segment.text,
            files: await listHandoffFiles(thread.workdir),
            closeout: isReviewerRole(team.find((m) => m.agentId === currentAgent)?.role)
              ? 'reviewer'
              : 'default',
          },
        )
      : currentTask;

    const hopResult = await runAgentTurn(
      context,
      thread,
      currentAgent,
      prompt,
      systemPrompt,
      writeQueue,
    );
    lastAssistant = hopResult.assistant;
    lastOutput = hopResult.output;
    prevContent = hopResult.content;

    // A2A 接力:回复行首 @ 其他角色 → 交接;已出场/不可用/无任务则停
    if (context.signal?.aborted || lastOutput.status !== 'completed') break;
    const handoff = parseA2AHandoff(prevContent, currentAgent, catalog);
    if (handoff && isReviewerRole(team.find((m) => m.agentId === currentAgent)?.role)) {
      turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'reviewer-closeout' });
      stop = { kind: 'reviewer-closeout' };
      break;
    }
    if (!handoff) {
      turnLog('a2a stop', { thread: thread.id, from: currentAgent });
      const inline = findInlineA2AMentions(prevContent, currentAgent, catalog);
      if (inline.length > 0) {
        const labels = inline.map((id) => `@${displayName(id, catalog)}`).join('、');
        await writeQueue(() =>
          context.stores.messages.append({
            threadId: thread.id,
            role: 'system',
            content: `💡 ${labels} 写在句中不会交接 — 请另起一行、行首写 @名字 再跟任务`,
            status: 'completed',
          }),
        );
      }
      stop = { kind: 'no-handoff', hadInlineHint: inline.length > 0 };
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
        }),
      );
      break;
    }
    await writeQueue(() =>
      context.stores.messages.append({
        threadId: thread.id,
        role: 'system',
        content: `🤝 接力:${displayName(currentAgent, catalog)} → ${displayName(handoff.target, catalog)}`,
        status: 'completed',
      }),
    );
    turnLog('a2a', {
      thread: thread.id,
      from: currentAgent,
      to: handoff.target,
      task: clip(handoff.task, 60),
    });
    fromAgent = currentAgent;
    currentAgent = handoff.target;
    currentTask = handoff.task;
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
      }),
    );
  } else if (lastOutput.status === 'completed' && stop) {
    const note = formatDroppedBallNote({
      stop: stop.kind,
      lastContent: prevContent,
      speakerName: displayName(currentAgent, catalog),
      role: team.find((m) => m.agentId === currentAgent)?.role,
      wasRelay: Boolean(fromAgent),
      hadInlineHint: stop.hadInlineHint,
      blockedTargetName: stop.blockedTarget
        ? displayName(stop.blockedTarget, catalog)
        : undefined,
    });
    if (note) {
      turnLog('a2a stop', { thread: thread.id, from: currentAgent, reason: 'dropped-ball' });
      await writeQueue(() =>
        context.stores.messages.append({
          threadId: thread.id,
          role: 'system',
          content: note,
          status: 'completed',
        }),
      );
    }
  }
  return { lastAssistant, lastOutput, visited, firstAgent };
}

function isReviewerRole(role?: string): boolean {
  return Boolean(role && role.includes('审查'));
}

async function listHandoffFiles(workdir: string): Promise<string[]> {
  try {
    return await gitChangedPaths(workdir);
  } catch {
    return [];
  }
}

async function runAgentTurn(
  context: TurnContext,
  thread: ThreadRuntime,
  currentAgent: AgentId,
  prompt: string,
  systemPrompt: string | undefined,
  writeQueue: WriteQueue,
): Promise<{ assistant: Message; output: AgentTurnOutput; content: string }> {
  const service = context.registry.get(currentAgent);
  if (!service) throw new Error(`没有可用的 agent: ${currentAgent}`);

  const assistantMessage = await writeQueue(() =>
    context.stores.messages.append({
      threadId: thread.id,
      role: 'assistant',
      agentId: currentAgent,
      content: '',
      status: 'streaming',
    }),
  );

  context.onStart?.(thread.id, assistantMessage.id, currentAgent);
  const started = Date.now();
  turnLog('hop start', { thread: thread.id, agent: currentAgent });

  let accumulated = '';
  let thinking = '';
  let activities: ToolActivity[] = [];
  const output = await service.runTurn({
    prompt,
    systemPrompt,
    sessionId: thread.sessions[currentAgent],
    workdir: thread.workdir,
    signal: context.signal,
    onIncrement: (delta) => {
      accumulated += delta;
      context.onIncrement?.(thread.id, assistantMessage.id, delta, currentAgent);
    },
    onThinking: (delta) => {
      thinking += delta;
      context.onThinking?.(thread.id, assistantMessage.id, delta, currentAgent);
    },
    onActivity: (activity) => {
      activities = upsertToolActivity(activities, activity);
      const latest = activities.find((a) => a.id === activity.id) ?? activity;
      context.onActivity?.(thread.id, assistantMessage.id, latest, currentAgent);
    },
  });

  if (output.sessionId && thread.sessions[currentAgent] !== output.sessionId) {
    await context.stores.threads.setSession(thread.id, currentAgent, output.sessionId);
  }

  turnLog('hop done', {
    thread: thread.id,
    agent: currentAgent,
    status: output.status,
    tools: activities.filter((a) => a.name !== '思考').length,
    ms: Date.now() - started,
    error: output.error ? clip(output.error, 80) : undefined,
  });

  const assistant = await writeQueue(() =>
    context.stores.messages.patch(thread.id, assistantMessage.id, {
      content: output.content || accumulated,
      status: output.status,
      usage: output.usage,
      error: output.error,
      sessionId: output.sessionId || undefined,
      ...(activities.length > 0
        ? { activities: finalizeActivities(activities, output.status === 'completed') }
        : {}),
      ...(thinking ? { thinking } : {}),
    }),
  );

  try {
    const repoRoot = resolve(thread.workdir, '..', '..');
    await sweepStrayFiles(repoRoot, thread.workdir);
  } catch {
    // 清扫失败不阻塞
  }

  return { assistant, output, content: output.content || accumulated };
}

function reviewPrompt(diff: { stat: string; text: string }): string {
  return (
    '请作为审查官审查以下代码改动,只审查线程工作目录中本次产生的改动,不要审查平台自身代码。' +
    '输出:问题列表→建议→结论(通过/需修改)。结论必须单独写明「通过」或「需修改」。' +
    '没看到或没亲手跑出命令+结果,不能写通过。' +
    '需修改时列出要点,不要问人,不要 @ 其他人(平台会按结论自动打回写手再审)。\n\n' +
    `${diff.stat}\n\n${diff.text}`
  );
}

async function runReviewFixThenCard(input: {
  context: TurnContext;
  thread: ThreadRuntime;
  threadId: string;
  writerAgentId: AgentId;
  chainLastAgent?: AgentId;
  chainLastContent?: string;
  initialDiff: { text: string; stat: string };
  writeQueue: WriteQueue;
  catalog: MentionCatalog;
  team: readonly TeamMember[];
  refs: EvidenceEntry[];
}): Promise<void> {
  const { context, thread, threadId, writerAgentId, writeQueue, catalog, team, refs } = input;
  const available = context.registry.list();
  const chainReviewer =
    input.chainLastAgent &&
    input.chainLastAgent !== writerAgentId &&
    available.includes(input.chainLastAgent)
      ? input.chainLastAgent
      : undefined;
  const reviewerAgentId = chainReviewer ?? selectReviewer(writerAgentId, available, team);
  turnLog('review start', {
    thread: threadId,
    writer: writerAgentId,
    reviewer: reviewerAgentId,
    reused: Boolean(chainReviewer),
  });
  let latestDiff = input.initialDiff;
  let reviewComment = '(无可用审查 agent)';

  if (reviewerAgentId && reviewerAgentId !== writerAgentId && context.registry.get(reviewerAgentId)) {
    const reviewSkill = (await context.stores.skills.list()).find((s: Skill) => s.id === 'review');
    const reviewerStored = (await context.stores.profiles.get(reviewerAgentId)) ?? undefined;
    const reviewerSpec = context.agents?.find((a) => a.id === reviewerAgentId);
    const reviewerPrompt = buildSystemPrompt({
      profile: overlayProfile(reviewerStored, reviewerSpec),
      team,
      skills: reviewSkill ? [reviewSkill] : [],
      evidenceRefs: [],
    });

    const runReview = async (): Promise<string> => {
      await writeQueue(() =>
        context.stores.messages.append({
          threadId,
          role: 'system',
          content: `🤝 审查:${displayName(writerAgentId, catalog)} → ${displayName(reviewerAgentId, catalog)}`,
          status: 'completed',
        }),
      );
      const reviewHop = await runAgentTurn(
        context,
        thread,
        reviewerAgentId,
        reviewPrompt(latestDiff),
        reviewerPrompt,
        writeQueue,
      );
      return reviewHop.content || '(审查无输出)';
    };

    reviewComment =
      chainReviewer && input.chainLastContent
        ? input.chainLastContent
        : await runReview();

    for (let fix = 0; fix < MAX_REVIEW_FIX_ROUNDS; fix++) {
      if (parseReviewVerdict(reviewComment) !== 'revise') break;
      turnLog('review revise', { thread: threadId, round: fix + 1, writer: writerAgentId });
      await writeQueue(() =>
        context.stores.messages.append({
          threadId,
          role: 'system',
          content: `🤝 打回:${displayName(reviewerAgentId, catalog)} → ${displayName(writerAgentId, catalog)}`,
          status: 'completed',
        }),
      );
      const writerStored = thread.sessions[writerAgentId]
        ? undefined
        : ((await context.stores.profiles.get(writerAgentId)) ?? undefined);
      const writerSpec = context.agents?.find((a) => a.id === writerAgentId);
      const writerProfile = overlayProfile(writerStored, writerSpec);
      const fixSkills = await matchSkills(reviewComment, await context.stores.skills.list());
      const fixPrompt = formatA2AHandoffPrompt(
        displayName(reviewerAgentId, catalog),
        reviewerAgentId,
        reviewComment,
        '审查结论为需修改。请只修复上述问题,改完不要问人,不要再 @ 审查官(平台会自动再审一轮)。',
      );
      await runAgentTurn(
        context,
        thread,
        writerAgentId,
        fixPrompt,
        buildSystemPrompt({
          profile: writerProfile,
          team,
          skills: fixSkills,
          evidenceRefs: refs,
        }),
        writeQueue,
      );
      await gitAddAll(thread.workdir);
      latestDiff = (await gitDiffHead(thread.workdir)) ?? latestDiff;
      reviewComment = await runReview();
    }
  }

  const card = await context.stores.approvals.create({
    threadId,
    writerAgentId,
    reviewerAgentId: reviewerAgentId ?? writerAgentId,
    diffText: latestDiff.text,
    diffStat: latestDiff.stat,
  });
  await context.stores.approvals.setReviewComment(card.id, reviewComment);

  const writerTexts = (await context.stores.messages.list(threadId))
    .filter((m) => m.role === 'assistant' && m.agentId === writerAgentId)
    .map((m) => m.content);
  const gated = gateReviewVerdict(reviewComment, writerTexts);
  const writerProfile = await context.stores.profiles.get(writerAgentId);
  const autoApplied = allowsAutoApprove(reviewComment, writerProfile?.autoApprove, writerTexts);
  if (autoApplied) {
    await context.stores.approvals.approve(card.id);
    try {
      await gitCommit(thread.workdir, `approve ${card.id}`);
    } catch {
      // 提交失败不阻塞,批准决策生效
    }
    await context.stores.approvals.markApplied(card.id);
  }

  const revise = gated === 'revise';
  const incomplete = gated === 'incomplete';
  turnLog('card', {
    thread: threadId,
    id: card.id,
    verdict: gated,
    auto: autoApplied,
    stat: clip(latestDiff.stat, 60),
  });
  await context.stores.messages.append({
    threadId,
    role: 'system',
    content: autoApplied
      ? `🤖 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n✅ 已自动批准(autoApprove)`
      : revise
        ? `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n互审后仍需修改，请你决定是否落地。\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`
        : incomplete
          ? `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n⚠️ 结论不算通过:没有本轮验证证据（命令+结果）。\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`
          : `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`,
    status: 'completed',
  });
}

