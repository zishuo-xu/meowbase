import { resolve } from 'node:path';
import {
  formatHoldCommandDoneNote,
  formatHoldCommandWakePrompt,
} from '@meowbase/shared';
import { runHoldCommand } from '../../services/hold-command.js';
import type { TurnContext } from './types.js';

export async function finishHoldCommandThenWake(input: {
  threadId: string;
  context: TurnContext;
}): Promise<void> {
  const { threadId, context } = input;
  const thread = await context.stores.threads.get(threadId);
  const pending = thread?.pendingHop;
  if (!pending?.holdCommand || !thread) return;
  const result = await runHoldCommand({
    threadId,
    command: pending.holdCommand,
    cwd: resolve(thread.workdir),
    signal: context.signal,
  });
  const still = (await context.stores.threads.get(threadId))?.pendingHop;
  if (!still?.holdCommand || still.holdCommand !== pending.holdCommand) return;
  await context.stores.messages.append({
    threadId,
    role: 'system',
    content: formatHoldCommandDoneNote({
      command: pending.holdCommand,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    }),
    status: 'completed',
  });
  await context.stores.threads.setPendingHop(threadId, {
    ...pending,
    from: pending.to,
    task: formatHoldCommandWakePrompt({
      command: pending.holdCommand,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      previousOutput: pending.previousOutput,
    }),
    holdCommand: undefined,
  });
}
