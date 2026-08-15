import { beforeAll, describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import { createRedisClient } from '../src/redis.js';
import { createMessageStore, createThreadStore } from '../src/stores/factories.js';

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

describe('Redis 存储', () => {
  it('线程 CRUD 与会话映射', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const thread = await threads.create({ title: 'redis-t', primaryAgentId: 'claude' });
    expect((await threads.get(thread.id))?.title).toBe('redis-t');
    await threads.setSession(thread.id, 'claude', 'sess-9');
    expect((await threads.get(thread.id))?.sessions.claude).toBe('sess-9');
  });

  it('消息追加与 patch', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const messages = createMessageStore(redis);
    const thread = await threads.create({ title: 'redis-m', primaryAgentId: 'claude' });
    const m = await messages.append({
      threadId: thread.id, role: 'assistant', content: 'x', status: 'streaming',
    });
    const patched = await messages.patch(thread.id, m.id, { content: 'y', status: 'completed' });
    expect(patched.content).toBe('y');
    expect((await messages.list(thread.id)).length).toBe(1);
  });
});
