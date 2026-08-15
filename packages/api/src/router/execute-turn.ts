import { resolveTargetAgent } from '@meowbase/shared';
import type { AgentId, Message } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type { MessageStore, ThreadStore } from '../stores/ports.js';

export interface TurnContext {
  stores: { threads: ThreadStore; messages: MessageStore };
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

  const targetAgentId: AgentId = resolveTargetAgent(content, thread.primaryAgentId);
  const service = context.registry.get(targetAgentId);
  if (!service) throw new Error(`没有可用的 agent: ${targetAgentId}`);

  await context.stores.messages.append({
    threadId,
    role: 'user',
    agentId: targetAgentId,
    content,
    status: 'completed',
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

  return context.stores.messages.patch(threadId, assistantMessage.id, {
    content: output.content || accumulated,
    status: output.status,
    usage: output.usage,
    error: output.error,
    sessionId: output.sessionId || undefined,
  });
}
