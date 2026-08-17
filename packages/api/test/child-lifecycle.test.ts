import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { attachChildKillers } from '../src/providers/child-lifecycle.js';

describe('attachChildKillers', () => {
  it('abort 杀掉子进程', async () => {
    const child = spawn('sleep', ['30']);
    const ac = new AbortController();
    const killers = attachChildKillers(child, { timeoutMs: 5_000, signal: ac.signal });
    ac.abort();
    await new Promise<void>((resolve) => child.on('close', () => resolve()));
    killers.clear();
    expect(killers.aborted()).toBe(true);
    expect(killers.timedOut()).toBe(false);
  });
});
