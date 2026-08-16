import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenCodeAdapter } from '../src/providers/opencode.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-opencode.mjs');

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
});
