import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as factory from '../src/providers/factory.js';
import { resolveExecutable, verifyModelConnection } from '../src/providers/verify-model.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');

describe('verifyModelConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('CLI 不存在时 stage=bin', async () => {
    expect(await resolveExecutable('meowbase-no-such-cli-xyz')).toBeNull();
    const result = await verifyModelConnection({
      bin: 'meowbase-no-such-cli-xyz',
      model: 'sonnet',
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('bin');
    expect(result.error).toMatch(/找不到 CLI/);
  });

  it('假 CLI 探测成功', async () => {
    const result = await verifyModelConnection({
      bin: FAKE_BIN,
      model: 'sonnet',
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe('model');
    expect(result.preview).toContain('claude');
  });

  it('模型名为空不调用适配器', async () => {
    const createSpy = vi.spyOn(factory, 'createAdapter');
    const result = await verifyModelConnection({
      bin: FAKE_BIN,
      model: '   ',
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('探测成功时透出 usage', async () => {
    const usage = { inputTokens: 10, outputTokens: 4, costUsd: 0.01 };
    vi.spyOn(factory, 'createAdapter').mockReturnValue({
      agentId: 'opencode',
      runTurn: async () => ({
        sessionId: 's',
        content: 'pong',
        status: 'completed',
        usage,
      }),
    });
    const result = await verifyModelConnection({
      bin: FAKE_BIN,
      model: 'sonnet',
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(true);
    expect(result.usage).toEqual(usage);
  });

  it('探测失败也透出 CLI 报的 usage', async () => {
    const usage = { inputTokens: 8, outputTokens: 2 };
    vi.spyOn(factory, 'createAdapter').mockReturnValue({
      agentId: 'opencode',
      runTurn: async () => ({
        sessionId: 's',
        content: '',
        status: 'failed',
        error: '解析失败',
        usage,
      }),
    });
    const result = await verifyModelConnection({
      bin: FAKE_BIN,
      model: 'sonnet',
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    expect(result.usage).toEqual(usage);
  });
});
