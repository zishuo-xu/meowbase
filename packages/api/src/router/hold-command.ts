import { spawn } from 'node:child_process';

export const HOLD_COMMAND_TIMEOUT_MS = 180_000;

const running = new Map<string, { kill: () => void }>();

export function killHoldCommand(threadId: string): void {
  running.get(threadId)?.kill();
  running.delete(threadId);
}

export async function runHoldCommand(input: {
  threadId: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}> {
  killHoldCommand(input.threadId);
  const timeoutMs = input.timeoutMs ?? HOLD_COMMAND_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      running.delete(input.threadId);
      input.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, cancelled });
    };

    const kill = () => {
      cancelled = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 800).unref();
    };

    const onAbort = () => {
      kill();
    };

    running.set(input.threadId, { kill });
    if (input.signal?.aborted) {
      kill();
    } else {
      input.signal?.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      stderr += err.message;
      finish(1);
    });
    child.on('close', (code) => {
      finish(code);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
  });
}
