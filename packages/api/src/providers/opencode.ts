import { spawn } from 'node:child_process';
import type { AgentId } from '@meowbase/shared';
import { OpenCodeAccumulator } from './opencode-json.js';
import { formatCliExitError } from './cli-error.js';
import { spawnEnv } from './base-url.js';
import { emitParsedLine } from './tool-activity.js';
import { attachChildKillers } from './child-lifecycle.js';
import type { AdapterOpts, AgentService, AgentTurnInput, AgentTurnOutput } from './types.js';

export class OpenCodeAdapter implements AgentService {
  readonly agentId: AgentId;

  constructor(
    private readonly opts: AdapterOpts = {},
  ) {
    this.agentId = opts.agentId ?? 'opencode';
  }

  async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const bin = this.opts.bin ?? process.env.OPENCODE_BIN ?? 'opencode';
    const timeoutMs = input.timeoutMs ?? this.opts.timeoutMs ?? 300_000;
    const model =
      this.opts.model ??
      process.env.OPENCODE_MODEL ??
      'opencode-go/deepseek-v4-flash';

    // opencode run 无系统提示词参数:身份/规则前置拼进用户 prompt
    const prompt = input.systemPrompt
      ? `${input.systemPrompt}\n\n---\n${input.prompt}`
      : input.prompt;

    const args = ['run', prompt, '--format', 'json', '--auto', '--thinking'];
    if (input.sessionId) args.push('--session', input.sessionId);
    args.push('-m', model);

    const accumulator = new OpenCodeAccumulator();
    const child = spawn(bin, args, {
      cwd: input.workdir,
      env: spawnEnv(this.opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const killers = attachChildKillers(child, { timeoutMs, signal: input.signal });

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
          emitParsedLine(input, delta, accumulator.takeActivities(), accumulator.takeThinking());
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
    killers.clear();

    const sessionId = accumulator.sessionId ?? input.sessionId ?? '';
    if (killers.aborted()) {
      return {
        sessionId,
        content: accumulator.content,
        status: 'terminated',
        usage: accumulator.usage,
        error: '已中止',
      };
    }
    if (killers.timedOut()) {
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
    if (exitCode !== 0) {
      return {
        sessionId,
        content: accumulator.content,
        status: 'failed',
        usage: accumulator.usage,
        error: formatCliExitError('opencode', exitCode, stderrChunks.join('')),
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
