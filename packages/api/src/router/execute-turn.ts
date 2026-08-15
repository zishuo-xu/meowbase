import {
  buildSystemPrompt,
  matchSkills,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
  resolveTargetAgent,
} from '@meowbase/shared';
import type { AgentId, EvidenceEntry, Message } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type {
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from '../stores/ports.js';

export interface TurnContext {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
    skills: SkillStore;
  };
  registry: AgentRegistry;
  onIncrement?: (threadId: string, messageId: string, delta: string) => void;
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

  // #confirm 分支:纯系统操作,不路由给 agent
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

  const targetAgentId: AgentId = resolveTargetAgent(content, thread.primaryAgentId);
  const service = context.registry.get(targetAgentId);
  if (!service) throw new Error(`没有可用的 agent: ${targetAgentId}`);

  const learn = parseLearnCommand(content);
  const refIds = parseEvidenceRefs(content);

  // systemPrompt 组装:引用证据任意轮注入;profile 仅新会话注入
  const refs: EvidenceEntry[] = [];
  for (const id of refIds) {
    const entry = await context.stores.evidence.get(id);
    if (entry?.status === 'confirmed') refs.push(entry);
  }
  const isNewSession = !thread.sessions[targetAgentId];
  const profile = isNewSession
    ? ((await context.stores.profiles.get(targetAgentId)) ?? undefined)
    : undefined;
  const matchedSkills = await matchSkills(content, await context.stores.skills.list());
  const systemPrompt = buildSystemPrompt({
    profile,
    skills: matchedSkills,
    evidenceRefs: refs,
  });

  const assistantMessage = await context.stores.messages.append({
    threadId,
    role: 'assistant',
    agentId: targetAgentId,
    content: '',
    status: 'streaming',
  });

  let accumulated = '';
  const output = await service.runTurn({
    prompt: content,
    systemPrompt,
    sessionId: thread.sessions[targetAgentId],
    workdir: thread.workdir,
    onIncrement: (delta) => {
      accumulated += delta;
      void context.stores.messages.patch(threadId, assistantMessage.id, {
        content: accumulated,
      });
      context.onIncrement?.(threadId, assistantMessage.id, delta);
    },
  });

  if (output.sessionId && thread.sessions[targetAgentId] !== output.sessionId) {
    await context.stores.threads.setSession(threadId, targetAgentId, output.sessionId);
  }

  // #learn 沉淀:仅 completed 时生成 draft + 建议消息
  if (learn && output.status === 'completed' && output.content) {
    const draft = await context.stores.evidence.createDraft({
      threadId,
      kind: 'fact',
      title: learn.title,
      content: output.content,
    });
    await context.stores.messages.append({
      threadId,
      role: 'system',
      content: `💡 建议沉淀为证据:「${draft.title}」\n回复 #confirm ${draft.id} 确认`,
      status: 'completed',
    });
  }

  return context.stores.messages.patch(threadId, assistantMessage.id, {
    content: output.content || accumulated,
    status: output.status,
    usage: output.usage,
    error: output.error,
    sessionId: output.sessionId || undefined,
  });
}
