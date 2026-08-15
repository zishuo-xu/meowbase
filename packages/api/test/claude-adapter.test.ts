import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../src/providers/claude.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');
const ARGS_BIN = join(import.meta.dirname, 'fixtures', 'fake-claude-args.mjs');

describe('ClaudeAdapter', () => {
  it('跑通一轮:解析增量、得到全文与会话 ID', async () => {
    const adapter = new ClaudeAdapter({ bin: FAKE_BIN });
    const deltas: string[] = [];
    const output = await adapter.runTurn({
      prompt: '你好',
      workdir: '/tmp',
      onIncrement: (delta) => deltas.push(delta),
    });
    expect(deltas.join('')).toBe('你好! 我是 claude。');
    expect(output.content).toBe('你好! 我是 claude。');
    expect(output.sessionId).toBe('sess-fake');
    expect(output.status).toBe('completed');
    expect(output.usage?.inputTokens).toBe(10);
    expect(output.usage?.costUsd).toBe(0.0012);
  });

  it('超时返回 terminated', async () => {
    const adapter = new ClaudeAdapter({ bin: FAKE_BIN, timeoutMs: 1 });
    const output = await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    expect(output.status).toBe('terminated');
    expect(output.error).toContain('超时');
  });
});

describe('ClaudeAdapter 参数', () => {
  it('systemPrompt → --append-system-prompt;sessionId → --resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-args-'));
    const recordFile = join(dir, 'args.json');
    process.env.RECORD_ARGS_FILE = recordFile;
    const adapter = new ClaudeAdapter({ bin: ARGS_BIN });
    await adapter.runTurn({
      prompt: 'hi',
      workdir: '/tmp',
      sessionId: 'sess-old',
      systemPrompt: '你是 墨墨',
    });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    const promptIndex = args.indexOf('--append-system-prompt');
    expect(promptIndex).toBeGreaterThan(-1);
    expect(args[promptIndex + 1]).toBe('你是 墨墨');
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-old');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });
});
