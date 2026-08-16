import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveExecutable, verifyModelConnection } from '../src/providers/verify-model.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');

describe('verifyModelConnection', () => {
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
});
