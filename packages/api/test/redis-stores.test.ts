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
    const title = `redis-t-${Date.now()}`;
    const thread = await threads.create({ title, primaryAgentId: 'claude' });
    expect((await threads.get(thread.id))?.title).toBe(title);
    await threads.setSession(thread.id, 'claude', 'sess-9');
    expect((await threads.get(thread.id))?.sessions.claude).toBe('sess-9');
    await threads.setPendingHop(thread.id, {
      id: `hop-${Date.now()}`,
      to: 'gemini',
      from: 'claude',
      task: '请审查',
      goal: '写 add.ts',
      previousOutput: '写完了',
      visited: ['claude'],
      firstAgent: 'claude',
      hop: 1,
    });
    expect((await threads.get(thread.id))?.pendingHop?.to).toBe('gemini');
    await threads.setPendingHop(thread.id, null);
    expect((await threads.get(thread.id))?.pendingHop).toBeUndefined();
    await threads.rename(thread.id, '在沙箱写 add.ts');
    expect((await threads.get(thread.id))?.title).toBe('在沙箱写 add.ts');
    expect(await threads.delete(thread.id)).toBe(true);
    expect(await threads.get(thread.id)).toBeNull();
  });

  it('pending hop 租约:抢占互斥,非主人不能续/放,过期可被抢走', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const thread = await threads.create({
      title: `redis-lease-${Date.now()}`,
      primaryAgentId: 'claude',
    });
    expect(await threads.claimPendingHop(thread.id, 'runner-a', 60_000)).toBe(true);
    expect(await threads.claimPendingHop(thread.id, 'runner-b', 60_000)).toBe(false);
    expect(await threads.renewPendingHopLease(thread.id, 'runner-b', 60_000)).toBe(false);
    await threads.releasePendingHopLease(thread.id, 'runner-b');
    expect(await threads.claimPendingHop(thread.id, 'runner-b', 60_000)).toBe(false);
    expect(await threads.renewPendingHopLease(thread.id, 'runner-a', 60_000)).toBe(true);
    await threads.releasePendingHopLease(thread.id, 'runner-a');
    expect(await threads.claimPendingHop(thread.id, 'runner-b', 60_000)).toBe(true);
    await threads.releasePendingHopLease(thread.id, 'runner-b');

    const other = await threads.create({
      title: `redis-lease-exp-${Date.now()}`,
      primaryAgentId: 'claude',
    });
    expect(await threads.claimPendingHop(other.id, 'dead', 20)).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(await threads.renewPendingHopLease(other.id, 'dead', 60_000)).toBe(false);
    expect(await threads.claimPendingHop(other.id, 'alive', 60_000)).toBe(true);
    await threads.releasePendingHopLease(other.id, 'alive');
    await threads.delete(thread.id);
    await threads.delete(other.id);
  });

  it('forceClaimPendingHop 覆盖别人的租约,新主人能续旧主人不能', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const thread = await threads.create({
      title: `redis-force-lease-${Date.now()}`,
      primaryAgentId: 'claude',
    });
    expect(await threads.claimPendingHop(thread.id, 'old-runner', 60_000)).toBe(true);
    await threads.forceClaimPendingHop(thread.id, 'new-runner', 60_000);
    expect(await threads.renewPendingHopLease(thread.id, 'old-runner', 60_000)).toBe(false);
    expect(await threads.renewPendingHopLease(thread.id, 'new-runner', 60_000)).toBe(true);
    expect(await threads.claimPendingHop(thread.id, 'third', 60_000)).toBe(false);
    await threads.releasePendingHopLease(thread.id, 'new-runner');
    await threads.delete(thread.id);
  });

  it('clearPendingHopIfSame:同 id 才清;无 id 旧记录 hydrate 补上', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const thread = await threads.create({
      title: `redis-clear-${Date.now()}`,
      primaryAgentId: 'claude',
    });
    const hop = {
      id: `hop-a-${Date.now()}`,
      to: 'gemini' as const,
      from: 'claude' as const,
      task: '请审查',
      goal: '写 add.ts',
      previousOutput: '写完了',
      visited: ['claude' as const],
      firstAgent: 'claude' as const,
      hop: 1,
    };
    await threads.setPendingHop(thread.id, hop);
    expect(await threads.clearPendingHopIfSame(thread.id, 'hop-other')).toBe(false);
    expect((await threads.get(thread.id))?.pendingHop?.id).toBe(hop.id);
    expect(await threads.clearPendingHopIfSame(thread.id, hop.id)).toBe(true);
    expect((await threads.get(thread.id))?.pendingHop).toBeUndefined();

    await redis.hset(`thread:${thread.id}`, 'pendingHop', JSON.stringify({
      to: 'gemini',
      from: 'claude',
      task: '请审查',
      goal: '写 add.ts',
      previousOutput: '写完了',
      visited: ['claude'],
      firstAgent: 'claude',
      hop: 1,
    }));
    const hydrated = await threads.get(thread.id);
    expect(hydrated?.pendingHop?.id).toBeTruthy();
    expect(hydrated?.pendingHop?.to).toBe('gemini');
    await threads.delete(thread.id);
  });

  it('线程 repo 绑定写入并回读', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const title = `redis-repo-${Date.now()}`;
    const thread = await threads.create({
      title,
      primaryAgentId: 'claude',
      repo: { path: '/src/myapp', baseBranch: 'develop' },
    });
    const loaded = await threads.get(thread.id);
    expect(loaded?.repo).toEqual({
      path: '/src/myapp',
      baseBranch: 'develop',
      branch: `meow/${thread.id}`,
    });
    await threads.delete(thread.id);
  });

  it('消息追加与 patch', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const messages = createMessageStore(redis);
    const thread = await threads.create({
      title: `redis-m-${Date.now()}`,
      primaryAgentId: 'claude',
    });
    const m = await messages.append({
      threadId: thread.id, role: 'assistant', content: 'x', status: 'streaming',
    });
    const patched = await messages.patch(thread.id, m.id, { content: 'y', status: 'completed' });
    expect(patched.content).toBe('y');
    expect((await messages.list(thread.id)).length).toBe(1);
    await messages.deleteAll(thread.id);
    await threads.delete(thread.id);
    expect(await messages.list(thread.id)).toEqual([]);
  });

  it('系统消息 round-trip 保留 systemKind/systemMeta', async () => {
    if (!redis) return;
    const threads = createThreadStore(redis);
    const messages = createMessageStore(redis);
    const thread = await threads.create({
      title: `redis-kind-${Date.now()}`,
      primaryAgentId: 'claude',
    });
    const m = await messages.append({
      threadId: thread.id,
      role: 'system',
      content: '🤝 接力:墨墨 → 团团',
      status: 'completed',
      systemKind: 'relay',
      systemMeta: { from: 'claude', to: 'opencode' },
    });
    const loaded = await messages.get(thread.id, m.id);
    expect(loaded?.systemKind).toBe('relay');
    expect(loaded?.systemMeta).toEqual({ from: 'claude', to: 'opencode' });
    const listed = await messages.list(thread.id);
    expect(listed[0]?.systemKind).toBe('relay');
    expect(listed[0]?.systemMeta).toEqual({ from: 'claude', to: 'opencode' });
    await messages.deleteAll(thread.id);
    await threads.delete(thread.id);
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
