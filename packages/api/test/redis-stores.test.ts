import { beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createRedisClient } from '../src/redis.js';
import {
  createEvidenceStore,
  createMessageStore,
  createProfileStore,
  createThreadStore,
} from '../src/stores/factories.js';
import { ensureSeededProfiles } from '../src/stores/seeds.js';

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

describe('Redis Profile/Evidence 存储', () => {
  it('profile 读写 + 种子幂等', async () => {
    if (!redis) return;
    const profiles = createProfileStore(redis);
    await ensureSeededProfiles(profiles);
    await ensureSeededProfiles(profiles);
    expect((await profiles.list()).length).toBe(3);
    expect((await profiles.get('claude'))?.name).toBe('墨墨');
  });

  it('evidence draft → confirm', async () => {
    if (!redis) return;
    // 用唯一 threadId,避免历史测试数据污染断言
    const threadId = `t-${Date.now()}`;
    const evidence = createEvidenceStore(redis);
    const draft = await evidence.createDraft({ threadId, kind: 'fact', title: 'x', content: 'y' });
    const confirmed = await evidence.confirm(draft.id);
    expect(confirmed?.status).toBe('confirmed');
    expect((await evidence.list(threadId)).length).toBe(1);
  });
});
