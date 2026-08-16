import { spawn } from 'node:child_process';
import type { AgentId } from '@meowbase/shared';
import { OpenCodeAccumulator } from './opencode-json.js';
import type { AgentService, AgentTurnInput, AgentTurnOutput } from './types.js';

export class OpenCodeAdapter implements AgentService {
  readonly agentId: AgentId = 'opencode';

  constructor(
    private readonly opts: { bin?: string; model?: string; timeoutMs?: number } = {},
  ) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const bin = this.opts.bin ?? process.env.OPENCODE_BIN ?? 'opencode';
    const timeoutMs = input.timeoutMs ?? this.opts.timeoutMs ?? 300_000;
    const model =
      this.opts.model ??
      process.env.OPENCODE_MODEL ??
      'opencode-go/deepseek-v4-flash';

    const args = ['run', input.prompt, '--format', 'json', '--auto'];
    if (input.sessionId) args.push('--session', input.sessionId);
    args.push('-m', model);

    const accumulator = new OpenCodeAccumulator();
    const child = spawn(bin, args, { cwd: input.workdir, stdio: ['ignore', 'pipe', 'pipe'] });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const stderrChunks: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

    let buffer = '';
    let exitCode: number | null = null;
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const delta = accumulator.push(line);
          if (delta && input.onIncrement) input.onIncrement(delta);
        }
      });
      child.on('close', (code) => {
        exitCode = code;
        resolve();
      });
      child.on('error', (err) => {
        stderrChunks.push(String(err));
        resolve();
      });
    });
    clearTimeout(timer);

    const sessionId = accumulator.sessionId ?? input.sessionId ?? '';
    if (timedOut) {
      return {
        sessionId,
        content: accumulator.content,
        status: 'terminated',
        usage: accumulator.usage,
        error: `opencode 执行超时(${timeoutMs}ms)`,
      };
    }
    if (accumulator.status === 'failed') {
      return {
        sessionId,
        content: accumulator.content,
        status: 'failed',
        usage: accumulator.usage,
        error: accumulator.error ?? 'opencode 执行失败',
      };
    }
    if (exitCode !== null && exitCode !== 0) {
      return {
        sessionId,
        content: accumulator.content,
        status: 'failed',
        usage: accumulator.usage,
        error: `opencode 退出码 ${exitCode}`,
      };
    }
    return {
      sessionId,
      content: accumulator.content,
      status: 'completed',
      usage: accumulator.usage,
    };
  }
}
