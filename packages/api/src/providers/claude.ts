import { spawn } from 'node:child_process';
import type { AgentId } from '@meowbase/shared';
import { StreamAccumulator } from './stream-json.js';
import { spawnEnv } from './base-url.js';
import { emitParsedLine } from './tool-activity.js';
import type { AdapterOpts, AgentService, AgentTurnInput, AgentTurnOutput } from './types.js';

export class ClaudeAdapter implements AgentService {
  readonly agentId: AgentId;

  constructor(
    private readonly opts: AdapterOpts = {},
  ) {
    this.agentId = opts.agentId ?? 'claude';
  }

  async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const bin = this.opts.bin ?? process.env.CLAUDE_BIN ?? 'claude';
    const timeoutMs = input.timeoutMs ?? this.opts.timeoutMs ?? 300_000;
    const model = this.opts.model ?? process.env.CLAUDE_MODEL;

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
    ];
    if (model) args.push('--model', model);
    if (input.sessionId) args.push('--resume', input.sessionId);
    if (input.systemPrompt && !input.sessionId) {
      args.push('--append-system-prompt', input.systemPrompt);
    }
    args.push(input.prompt);

    const accumulator = new StreamAccumulator();
    const child = spawn(bin, args, {
      cwd: input.workdir,
      env: spawnEnv(this.opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const stderrChunks: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

    let buffer = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const delta = accumulator.push(line);
          emitParsedLine(input, delta, accumulator.takeActivities(), accumulator.takeThinking());
        }
      });
      child.on('close', () => resolve());
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
        error: `claude 执行超时(${timeoutMs}ms)`,
      };
    }
    if (accumulator.status === 'failed') {
      return {
        sessionId,
        content: accumulator.content,
        status: 'failed',
        usage: accumulator.usage,
        error: accumulator.error ?? 'claude 执行失败',
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
