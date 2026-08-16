import {
  buildSystemPrompt,
  matchSkills,
  parseA2AHandoff,
  parseApproveCommand,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
  parseMentionSegments,
  parseRejectCommand,
  resolveTargetAgent,
  selectReviewer,
} from '@meowbase/shared';
import type { AgentId, EvidenceEntry, Message } from '@meowbase/shared';
import type { AgentRegistry, AgentService, AgentTurnOutput } from '../providers/types.js';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from '../stores/ports.js';
import { gitAddAll, gitCommit, gitDiffHead } from '../services/git.js';

/** A2A 接力最大链深(借鉴 clowder F046,默认 3 跳) */
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
  onIncrement?: (threadId: string, messageId: string, delta: string) => void;
}

interface SegmentRunResult {
  lastAssistant: Message;
  lastOutput: AgentTurnOutput;
  visited: Set<AgentId>;
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

  const segments = parseMentionSegments(content, thread.primaryAgentId);
  if (segments.length === 0) {
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: '⚠️ 没有可执行的任务文本',
      status: 'completed',
    });
  }

  // 分段接力:每段路由给对应角色;段内再跑 A2A 链(回复行首 @ 自动交接)
  let lastResult: SegmentRunResult | null = null;
  const sharedVisited = new Set<AgentId>();
  for (const segment of segments) {
    lastResult = await runSegment(context, thread, segment, refs, sharedVisited);
  }
  if (!lastResult) throw new Error('执行失败:未产生任何输出');

  const { lastAssistant, lastOutput, visited } = lastResult;

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
        const writerAgentId = lastAssistant.agentId ?? thread.primaryAgentId;
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
              prompt: `请作为审查官审查以下代码改动,输出:问题列表→建议→结论(通过/需修改)\n\n${diff.stat}\n\n${diff.text}`,
              systemPrompt: reviewerPrompt,
              workdir: thread.workdir,
            });
            reviewComment = reviewOutput.content || '(审查无输出)';
          }
        }
        await context.stores.approvals.setReviewComment(card.id, reviewComment);
        await context.stores.messages.append({
          threadId,
          role: 'system',
          content: `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${diff.stat}\n审查意见:${reviewComment}\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`,
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
): Promise<SegmentRunResult> {
  let lastAssistant: Message | null = null;
  let lastOutput: AgentTurnOutput | null = null;
  let currentAgent: AgentId = segment.agentId;
  let currentTask = segment.text;
  let prevContent = '';

  for (let hop = 0; hop <= MAX_A2A_DEPTH; hop++) {
    const service = context.registry.get(currentAgent);
    if (!service) {
      throw new Error(`没有可用的 agent: ${currentAgent}`);
    }
    visited.add(currentAgent);

    const isNewSession = !thread.sessions[currentAgent];
    const profile = isNewSession
      ? ((await context.stores.profiles.get(currentAgent)) ?? undefined)
      : undefined;
    const matchedSkills = await matchSkills(currentTask, await context.stores.skills.list());
    const systemPrompt = buildSystemPrompt({ profile, skills: matchedSkills, evidenceRefs: refs });
    const prompt = prevContent ? `${prevContent}\n\n---\n${currentTask}` : currentTask;

    const assistantMessage = await context.stores.messages.append({
      threadId: thread.id,
      role: 'assistant',
      agentId: currentAgent,
      content: '',
      status: 'streaming',
    });

    let accumulated = '';
    const output = await service.runTurn({
      prompt,
      systemPrompt,
      sessionId: thread.sessions[currentAgent],
      workdir: thread.workdir,
      onIncrement: (delta) => {
        accumulated += delta;
        void context.stores.messages.patch(thread.id, assistantMessage.id, {
          content: accumulated,
        });
        context.onIncrement?.(thread.id, assistantMessage.id, delta);
      },
    });

    if (output.sessionId && thread.sessions[currentAgent] !== output.sessionId) {
      await context.stores.threads.setSession(thread.id, currentAgent, output.sessionId);
    }

    lastAssistant = await context.stores.messages.patch(thread.id, assistantMessage.id, {
      content: output.content || accumulated,
      status: output.status,
      usage: output.usage,
      error: output.error,
      sessionId: output.sessionId || undefined,
    });
    lastOutput = output;
    prevContent = output.content || accumulated;

    // A2A 接力:回复行首 @ 其他角色 → 交接;已出场/不可用/无任务则停
    if (output.status !== 'completed') break;
    const handoff = parseA2AHandoff(prevContent, currentAgent);
    if (!handoff || visited.has(handoff.target) || !context.registry.get(handoff.target)) break;
    await context.stores.messages.append({
      threadId: thread.id,
      role: 'system',
      content: `🤝 接力:@${handoff.target}`,
      status: 'completed',
    });
    currentAgent = handoff.target;
    currentTask = handoff.task;
  }

  if (!lastAssistant || !lastOutput) throw new Error('执行失败:未产生任何输出');
  return { lastAssistant, lastOutput, visited };
}
