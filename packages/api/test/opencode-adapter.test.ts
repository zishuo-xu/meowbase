import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenCodeAdapter } from '../src/providers/opencode.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-opencode.mjs');
const ARGS_BIN = join(import.meta.dirname, 'fixtures', 'fake-opencode-args.mjs');

describe('OpenCodeAdapter', () => {
  it('跑通一轮:解析增量、usage、会话 ID', async () => {
    const adapter = new OpenCodeAdapter({ bin: FAKE_BIN });
    const deltas: string[] = [];
    const output = await adapter.runTurn({
      prompt: '审查', workdir: '/tmp', onIncrement: (d) => deltas.push(d),
    });
    expect(deltas.join('')).toBe('审查通过');
    expect(output.content).toBe('审查通过');
    expect(output.sessionId).toBe('ses-fake');
    expect(output.status).toBe('completed');
    expect(output.usage?.outputTokens).toBe(4);
  });

  it('超时返回 terminated', async () => {
    const adapter = new OpenCodeAdapter({ bin: FAKE_BIN, timeoutMs: 1 });
    const output = await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    expect(output.status).toBe('terminated');
  });

  it('systemPrompt 前置拼进用户 prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-ocargs-'));
    const recordFile = join(dir, 'args.json');
    process.env.RECORD_ARGS_FILE = recordFile;
    const adapter = new OpenCodeAdapter({ bin: ARGS_BIN });
    await adapter.runTurn({
      prompt: '写 mul.js',
      workdir: '/tmp',
      systemPrompt: '你是 团团',
    });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    const runPrompt = args[1];
    expect(runPrompt).toContain('你是 团团');
    expect(runPrompt).toContain('写 mul.js');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });
});
