import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeminiAdapter } from '../src/providers/gemini.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-gemini.mjs');
const ARGS_BIN = join(import.meta.dirname, 'fixtures', 'fake-gemini-args.mjs');

describe('GeminiAdapter', () => {
  it('跑通一轮:解析增量、得到全文与会话 ID', async () => {
    const adapter = new GeminiAdapter({ bin: FAKE_BIN });
    const deltas: string[] = [];
    const output = await adapter.runTurn({
      prompt: '你好',
      workdir: '/tmp',
      onIncrement: (delta) => deltas.push(delta),
    });
    expect(deltas.join('')).toBe('你好! 我是 gemini。');
    expect(output.content).toBe('你好! 我是 gemini。');
    expect(output.sessionId).toBe('sess-gemini');
    expect(output.status).toBe('completed');
    expect(output.usage?.inputTokens).toBe(10);
    expect(output.usage?.cacheReadTokens).toBe(2);
  });

  it('超时返回 terminated', async () => {
    const adapter = new GeminiAdapter({ bin: FAKE_BIN, timeoutMs: 1 });
    const output = await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    expect(output.status).toBe('terminated');
    expect(output.error).toContain('超时');
  });
});

describe('GeminiAdapter 参数', () => {
  it('systemPrompt 前置拼进 prompt;sessionId → -r;输出 stream-json + yolo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-gargs-'));
    const recordFile = join(dir, 'args.json');
    process.env.RECORD_ARGS_FILE = recordFile;
    const adapter = new GeminiAdapter({ bin: ARGS_BIN, model: 'gemini-2.0-flash' });
    await adapter.runTurn({
      prompt: '审查这段 diff',
      workdir: '/tmp',
      sessionId: 'sess-old',
      systemPrompt: '你是 闪闪',
    });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    const promptIndex = args.indexOf('-p');
    expect(promptIndex).toBeGreaterThan(-1);
    expect(args[promptIndex + 1]).toContain('你是 闪闪');
    expect(args[promptIndex + 1]).toContain('审查这段 diff');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--approval-mode');
    expect(args[args.indexOf('--approval-mode') + 1]).toBe('yolo');
    expect(args).toContain('-r');
    expect(args[args.indexOf('-r') + 1]).toBe('sess-old');
    expect(args).toContain('-m');
    expect(args[args.indexOf('-m') + 1]).toBe('gemini-2.0-flash');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('退出码非 0 时带上 stderr', async () => {
    const failBin = join(import.meta.dirname, 'fixtures', 'fake-cli-fail.mjs');
    const adapter = new GeminiAdapter({ bin: failBin });
    const output = await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    expect(output.status).toBe('failed');
    expect(output.error).toMatch(/退出码 1/);
    expect(output.error).toMatch(/API key not found/);
  });
});
