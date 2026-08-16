import { resolve } from 'node:path';
import {
  buildMentionCatalog,
  buildSystemPrompt,
  DEFAULT_ROSTER,
  displayName,
  findInlineA2AMentions,
  formatA2AHandoffPrompt,
  matchSkills,
  parseA2AHandoff,
  parseApproveCommand,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
  parseMentionTargets,
  parseRejectCommand,
  selectReviewer,
  stripMentions,
} from '@meowbase/shared';
import type {
  AgentId,
  AgentProfile,
  EvidenceEntry,
  MentionCatalog,
  Message,
  TeamMember,
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
import { gitAddAll, gitCommit, gitDiffHead, sweepStrayFiles } from '../services/git.js';
import type { AgentSpec } from '../config.js';

/** A2A 接力链深上限(借鉴 clowder F046):链上最多出现 MAX_A2A_DEPTH 个 agent */
export const MAX_A2A_DEPTH = 3;

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
      ? context.agents.map((a) => ({ agentId: a.id, name: a.name, role: a.role }))
      : profiles.length > 0
        ? profiles.map((p) => ({ agentId: p.agentId, name: p.name, role: p.role }))
        : [...DEFAULT_ROSTER];
  const maxDepth = context.a2aMaxDepth ?? MAX_A2A_DEPTH;
  const targets = parseMentionTargets(content, thread.primaryAgentId, catalog);
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

  // 审批流:完成轮有 diff → 卡片 + 自动审查(整条链结束后只查一次)
  if (lastOutput.status === 'completed') {
    try {
      await gitAddAll(thread.workdir);
      const diff = await gitDiffHead(thread.workdir);
      if (diff) {
        // writer 归属链上首个执行者(改动可能由链上任何 agent 产生)
        const writerAgentId = chainFirstAgent ?? thread.primaryAgentId;
        const reviewerAgentId = selectReviewer(writerAgentId, context.registry.list());
        const card = await context.stores.approvals.create({
          threadId,
          writerAgentId,
          reviewerAgentId: reviewerAgentId ?? writerAgentId,
          diffText: diff.text,
          diffStat: diff.stat,
        });
        let reviewComment = '(无可用审查 agent)';
        if (reviewerAgentId && reviewerAgentId !== writerAgentId) {
          const reviewerService = context.registry.get(reviewerAgentId);
          if (reviewerService) {
            const reviewerProfile = await context.stores.profiles.get(reviewerAgentId);
            const reviewSkill = (await context.stores.skills.list()).find(
              (s) => s.id === 'review',
            );
            const reviewerPrompt = buildSystemPrompt({
              profile: reviewerProfile ?? undefined,
              skills: reviewSkill ? [reviewSkill] : [],
              evidenceRefs: [],
            });
            const reviewOutput = await reviewerService.runTurn({
              prompt: `请作为审查官审查以下代码改动,只审查线程工作目录中本次产生的改动,不要审查平台自身代码,输出:问题列表→建议→结论(通过/需修改)\n\n${diff.stat}\n\n${diff.text}`,
              systemPrompt: reviewerPrompt,
              workdir: thread.workdir,
            });
            reviewComment = reviewOutput.content || '(审查无输出)';
          }
        }
        await context.stores.approvals.setReviewComment(card.id, reviewComment);

        // autoApprove:写手角色配置了自动批准 → 审查后直接批准落地
        const writerProfile = await context.stores.profiles.get(writerAgentId);
        if (writerProfile?.autoApprove) {
          // 状态机要求:reviewing → approved → applied
          await context.stores.approvals.approve(card.id);
          try {
            await gitCommit(thread.workdir, `approve ${card.id}`);
          } catch {
            // 提交失败不阻塞,批准决策生效
          }
          await context.stores.approvals.markApplied(card.id);
        }

        await context.stores.messages.append({
          threadId,
          role: 'system',
          content: writerProfile?.autoApprove
            ? `🤖 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${diff.stat}\n审查意见:${reviewComment}\n✅ 已自动批准(autoApprove)`
            : `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${diff.stat}\n审查意见:${reviewComment}\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`,
          status: 'completed',
        });
      }
    } catch {
      // diff 计算失败不阻塞主流程
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

  for (let hop = 0; hop < maxDepth; hop++) {
    const service = context.registry.get(currentAgent);
    if (!service) {
      throw new Error(`没有可用的 agent: ${currentAgent}`);
    }
    visited.add(currentAgent);

    const isNewSession = !thread.sessions[currentAgent];
    const stored = isNewSession
      ? ((await context.stores.profiles.get(currentAgent)) ?? undefined)
      : undefined;
    const spec = context.agents?.find((a) => a.id === currentAgent);
    const profile = isNewSession ? overlayProfile(stored, spec) : undefined;
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
        )
      : currentTask;

    const assistantMessage = await writeQueue(() =>
      context.stores.messages.append({
        threadId: thread.id,
        role: 'assistant',
        agentId: currentAgent,
        content: '',
        status: 'streaming',
      }),
    );

    let accumulated = '';
    const output = await service.runTurn({
      prompt,
      systemPrompt,
      sessionId: thread.sessions[currentAgent],
      workdir: thread.workdir,
      onIncrement: (delta) => {
        // 只推送增量到 WS;落库由结束时的一次性 patch 完成,
        // 避免无锁 read-modify-write 并发覆盖(Redis 版竞态)
        accumulated += delta;
        context.onIncrement?.(thread.id, assistantMessage.id, delta, currentAgent);
      },
    });

    if (output.sessionId && thread.sessions[currentAgent] !== output.sessionId) {
      await context.stores.threads.setSession(thread.id, currentAgent, output.sessionId);
    }

    lastAssistant = await writeQueue(() =>
      context.stores.messages.patch(thread.id, assistantMessage.id, {
        content: output.content || accumulated,
        status: output.status,
        usage: output.usage,
        error: output.error,
        sessionId: output.sessionId || undefined,
      }),
    );
    lastOutput = output;
    prevContent = output.content || accumulated;

    // 沙箱清扫:agent 写到仓库根(沙箱外)的未跟踪文件移回线程沙箱
    try {
      const repoRoot = resolve(thread.workdir, '..', '..');
      await sweepStrayFiles(repoRoot, thread.workdir);
    } catch {
      // 清扫失败不阻塞
    }

    // A2A 接力:回复行首 @ 其他角色 → 交接;已出场/不可用/无任务则停
    if (output.status !== 'completed') break;
    const handoff = parseA2AHandoff(prevContent, currentAgent, catalog);
    if (!handoff) {
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
      break;
    }
    if (visited.has(handoff.target) || !context.registry.get(handoff.target)) break;
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
    fromAgent = currentAgent;
    currentAgent = handoff.target;
    currentTask = handoff.task;
  }

  if (!lastAssistant || !lastOutput) throw new Error('执行失败:未产生任何输出');
  return { lastAssistant, lastOutput, visited, firstAgent };
}
