import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../src/providers/claude.js';
import { createAdapter } from '../src/providers/factory.js';

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
  it('首轮 systemPrompt → --append-system-prompt;续聊只 --resume,避免身份叠进去', async () => {
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
    expect(args).not.toContain('--append-system-prompt');
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-old');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('无 session 时带上 --append-system-prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-args-sys-'));
    const recordFile = join(dir, 'args.json');
    process.env.RECORD_ARGS_FILE = recordFile;
    const adapter = new ClaudeAdapter({ bin: ARGS_BIN });
    await adapter.runTurn({
      prompt: 'hi',
      workdir: '/tmp',
      systemPrompt: '你是 墨墨',
    });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    const promptIndex = args.indexOf('--append-system-prompt');
    expect(promptIndex).toBeGreaterThan(-1);
    expect(args[promptIndex + 1]).toBe('你是 墨墨');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('headless 用 bypassPermissions,否则跑 node 会卡在审批', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-args-perm-'));
    const recordFile = join(dir, 'args.json');
    process.env.RECORD_ARGS_FILE = recordFile;
    const adapter = new ClaudeAdapter({ bin: ARGS_BIN });
    await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('配置了 model → --model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-args-model-'));
    const recordFile = join(dir, 'args.json');
    process.env.RECORD_ARGS_FILE = recordFile;
    const adapter = new ClaudeAdapter({ bin: ARGS_BIN, model: 'sonnet' });
    await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    delete process.env.RECORD_ARGS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('ClaudeAdapter 网关', () => {
  it('opts.env 注入到 spawn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-args-env-'));
    const recordFile = join(dir, 'env.json');
    process.env.RECORD_ENV_FILE = recordFile;
    const adapter = new ClaudeAdapter({
      bin: ARGS_BIN,
      env: { ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic' },
    });
    await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    const env = JSON.parse(readFileSync(recordFile, 'utf8')) as { ANTHROPIC_BASE_URL: string | null };
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.moonshot.cn/anthropic');
    delete process.env.RECORD_ENV_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('createAdapter 按协议规范化后注入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-factory-env-'));
    const recordFile = join(dir, 'env.json');
    process.env.RECORD_ENV_FILE = recordFile;
    const adapter = createAdapter(
      {
        id: 'claude',
        name: '墨墨',
        aliases: ['claude'],
        role: '写手',
        personality: '',
        expertise: [],
        bin: ARGS_BIN,
        protocol: 'anthropic',
        baseUrl: 'https://api.moonshot.cn/anthropic/v1',
        apiKey: 'sk-ant-test',
      },
      5_000,
    );
    await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    const env = JSON.parse(readFileSync(recordFile, 'utf8')) as {
      ANTHROPIC_BASE_URL: string | null;
      ANTHROPIC_API_KEY: string | null;
    };
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.moonshot.cn/anthropic');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    delete process.env.RECORD_ENV_FILE;
    rmSync(dir, { recursive: true, force: true });
  });
});
