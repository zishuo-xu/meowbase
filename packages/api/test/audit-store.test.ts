import { beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import type { AuditStore } from '../src/stores/ports.js';
import { createRedisClient } from '../src/redis.js';
import { createAuditStore, createMemoryStores } from '../src/stores/factories.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
let redis: Redis | null = null;

beforeAll(async () => {
  try {
    const client = createRedisClient(REDIS_URL);
    await client.ping();
    redis = client;
  } catch {
    redis = null;
  }
});

function uniqueThread(): string {
  return `t-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function seedThree(store: AuditStore, threadId: string) {
  const first = await store.append({
    threadId,
    actor: 'human',
    action: 'user-say',
    subject: '先开口',
  });
  await new Promise((r) => setTimeout(r, 2));
  const second = await store.append({
    threadId,
    actor: 'claude',
    action: 'hop-done',
    subject: '墨墨跑完',
    meta: { usage: { inputTokens: 3 } },
  });
  await new Promise((r) => setTimeout(r, 2));
  const third = await store.append({
    threadId,
    actor: 'platform',
    action: 'relay',
    subject: '交棒',
  });
  return { first, second, third };
}

function runSuite(label: string, create: () => Promise<AuditStore | null>): void {
  describe(label, () => {
    it('round-trip 新的在前', async () => {
      const store = await create();
      if (!store) return;
      const threadId = uniqueThread();
      const { first, second, third } = await seedThree(store, threadId);
      const listed = await store.list({ threadId });
      expect(listed.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
      expect(listed[0]?.ts).toBeTruthy();
      expect(listed[1]?.meta).toEqual({ usage: { inputTokens: 3 } });
    });

    it('按 threadId / actor / action / since 过滤', async () => {
      const store = await create();
      if (!store) return;
      const threadId = uniqueThread();
      const other = uniqueThread();
      const { first, second, third } = await seedThree(store, threadId);
      await store.append({ threadId: other, actor: 'human', action: 'user-say', subject: '别的线程' });

      expect((await store.list({ threadId })).map((r) => r.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
      expect((await store.list({ threadId, actor: 'human' })).map((r) => r.id)).toEqual([first.id]);
      expect((await store.list({ threadId, action: 'relay' })).map((r) => r.id)).toEqual([third.id]);

      const sinceSecond = await store.list({ threadId, since: second.ts });
      expect(sinceSecond.every((r) => r.ts >= second.ts)).toBe(true);
      expect(sinceSecond.map((r) => r.id)).toEqual([third.id, second.id]);
    });

    it('limit 默认 100、上限 500,倒序截断', async () => {
      const store = await create();
      if (!store) return;
      const threadId = uniqueThread();
      const { first, second, third } = await seedThree(store, threadId);
      const limited = await store.list({ threadId, limit: 2 });
      expect(limited.map((r) => r.id)).toEqual([third.id, second.id]);
      expect(limited.map((r) => r.id)).not.toContain(first.id);

      const over = await store.list({ threadId, limit: 999 });
      expect(over.length).toBeLessThanOrEqual(500);
      expect(over.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
    });
  });
}

runSuite('内存 AuditStore', async () => createMemoryStores().audit);
runSuite('Redis AuditStore', async () => (redis ? createAuditStore(redis) : null));
