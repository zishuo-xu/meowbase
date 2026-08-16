import { spawn } from 'node:child_process';
import type { AgentId } from '@meowbase/shared';
import { GeminiAccumulator } from './gemini-json.js';
import { formatCliExitError } from './cli-error.js';
import { spawnEnv } from './base-url.js';
import { emitParsedLine } from './tool-activity.js';
import type { AdapterOpts, AgentService, AgentTurnInput, AgentTurnOutput } from './types.js';

export class GeminiAdapter implements AgentService {
  readonly agentId: AgentId;

  constructor(
    private readonly opts: AdapterOpts = {},
  ) {
    this.agentId = opts.agentId ?? 'gemini';
  }

  async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const bin = this.opts.bin ?? process.env.GEMINI_BIN ?? 'gemini';
    const timeoutMs = input.timeoutMs ?? this.opts.timeoutMs ?? 300_000;
    const model = this.opts.model ?? process.env.GEMINI_MODEL;

    const prompt = input.systemPrompt
      ? `${input.systemPrompt}\n\n---\n${input.prompt}`
      : input.prompt;

    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--approval-mode',
      'yolo',
    ];
    if (input.sessionId) args.push('-r', input.sessionId);
    if (model) args.push('-m', model);

    const accumulator = new GeminiAccumulator();
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
    let exitCode: number | null = null;
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const delta = accumulator.push(line);
          emitParsedLine(input, delta, accumulator.takeActivities());
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
        error: `gemini 执行超时(${timeoutMs}ms)`,
      };
    }
    if (accumulator.status === 'failed') {
      return {
        sessionId,
        content: accumulator.content,
        status: 'failed',
        usage: accumulator.usage,
        error: accumulator.error ?? 'gemini 执行失败',
      };
    }
    if (exitCode !== 0) {
      return {
        sessionId,
        content: accumulator.content,
        status: 'failed',
        usage: accumulator.usage,
        error: formatCliExitError('gemini', exitCode, stderrChunks.join('')),
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
