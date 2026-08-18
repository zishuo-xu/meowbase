import { resolve } from 'node:path';
import type { AgentId, Message, ToolActivity } from '@meowbase/shared';
import type { AgentTurnOutput } from '../../providers/types.js';
import { finalizeActivities, upsertToolActivity } from '../../providers/tool-activity.js';
import { sweepStrayFiles } from '../../services/git.js';
import { clip, turnLog } from '../../services/turn-log.js';
import type { ThreadRuntime, TurnContext, WriteQueue } from './types.js';

export async function runAgentTurn(
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
