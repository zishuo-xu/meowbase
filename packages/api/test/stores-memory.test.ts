import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';

describe('内存存储', () => {
  it('创建线程并读取', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: '测试', primaryAgentId: 'claude' });
    expect(thread.title).toBe('测试');
    expect(thread.sessions).toEqual({});
    expect(thread.workdir).toBe(`work/${thread.id}`);
    expect(await threads.get(thread.id)).toEqual(thread);
    expect(await threads.get('不存在')).toBeNull();
  });

  it('create 可带 repo 绑定并补全 meow/<id> 分支', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({
      title: '绑仓',
      primaryAgentId: 'claude',
      repo: { path: '/src/myapp', baseBranch: 'main' },
    });
    expect(thread.repo).toEqual({
      path: '/src/myapp',
      baseBranch: 'main',
      branch: `meow/${thread.id}`,
    });
    expect((await threads.get(thread.id))?.repo).toEqual(thread.repo);
  });

  it('rename 改标题', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: '8/17 19:28', primaryAgentId: 'claude' });
    const renamed = await threads.rename(thread.id, '在沙箱写 add.ts');
    expect(renamed?.title).toBe('在沙箱写 add.ts');
    expect((await threads.get(thread.id))?.title).toBe('在沙箱写 add.ts');
    expect(await threads.rename('不存在', 'x')).toBeNull();
  });

  it('setSession 更新会话映射', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: 't', primaryAgentId: 'claude' });
    await threads.setSession(thread.id, 'claude', 'sess-1');
    const updated = await threads.get(thread.id);
    expect(updated?.sessions.claude).toBe('sess-1');
  });

  it('删除线程并清掉消息', async () => {
    const { threads, messages } = createMemoryStores();
    const thread = await threads.create({ title: 't', primaryAgentId: 'claude' });
    await messages.append({
      threadId: thread.id, role: 'user', content: 'hi', status: 'completed',
    });
    expect(await threads.delete(thread.id)).toBe(true);
    expect(await threads.get(thread.id)).toBeNull();
    await messages.deleteAll(thread.id);
    expect(await messages.list(thread.id)).toEqual([]);
    expect(await threads.delete('不存在')).toBe(false);
  });

  it('pending hop 租约:抢占互斥,非主人不能续/放,过期可被抢走', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: 'lease', primaryAgentId: 'claude' });
    expect(await threads.claimPendingHop(thread.id, 'runner-a', 60_000)).toBe(true);
    expect(await threads.claimPendingHop(thread.id, 'runner-b', 60_000)).toBe(false);
    expect(await threads.renewPendingHopLease(thread.id, 'runner-b', 60_000)).toBe(false);
    await threads.releasePendingHopLease(thread.id, 'runner-b');
    expect(await threads.claimPendingHop(thread.id, 'runner-b', 60_000)).toBe(false);
    expect(await threads.renewPendingHopLease(thread.id, 'runner-a', 60_000)).toBe(true);
    await threads.releasePendingHopLease(thread.id, 'runner-a');
    expect(await threads.claimPendingHop(thread.id, 'runner-b', 60_000)).toBe(true);

    const other = await threads.create({ title: 'lease-exp', primaryAgentId: 'claude' });
    expect(await threads.claimPendingHop(other.id, 'dead', 15)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(await threads.renewPendingHopLease(other.id, 'dead', 60_000)).toBe(false);
    expect(await threads.claimPendingHop(other.id, 'alive', 60_000)).toBe(true);
  });

  it('追加/读取/列表消息', async () => {
    const { threads, messages } = createMemoryStores();
    const thread = await threads.create({ title: 't', primaryAgentId: 'claude' });
    const m1 = await messages.append({
      threadId: thread.id, role: 'user', content: 'hi', status: 'completed',
    });
    const m2 = await messages.append({
      threadId: thread.id, role: 'assistant', agentId: 'claude', content: '', status: 'streaming',
    });
    expect(await messages.get(thread.id, m1.id)).toEqual(m1);
    expect((await messages.list(thread.id)).map((m) => m.id)).toEqual([m1.id, m2.id]);
  });

  it('patch 更新消息字段', async () => {
    const { threads, messages } = createMemoryStores();
    const thread = await threads.create({ title: 't', primaryAgentId: 'claude' });
    const m = await messages.append({
      threadId: thread.id, role: 'assistant', content: '', status: 'streaming',
    });
    const patched = await messages.patch(thread.id, m.id, {
      content: '完成', status: 'completed', usage: { inputTokens: 5 },
    });
    expect(patched.content).toBe('完成');
    expect(patched.status).toBe('completed');
    expect(patched.usage?.inputTokens).toBe(5);
  });
});

describe('内存 Profile/Evidence 存储', () => {
  it('profile 创建/读取/列表', async () => {
    const { profiles } = createMemoryStores();
    const created = await profiles.create({
      agentId: 'claude', name: '墨墨', personality: 'x', role: '写手', expertise: ['TS'],
    });
    expect(created.name).toBe('墨墨');
    expect(created.createdAt).toBeTruthy();
    expect(await profiles.get('claude')).toEqual(created);
    expect(await profiles.get('不存在')).toBeNull();
    expect((await profiles.list()).length).toBe(1);
  });

  it('draft 创建后 confirm 转正;重复 confirm 返回 null', async () => {
    const { evidence } = createMemoryStores();
    const draft = await evidence.createDraft({
      threadId: 't1', kind: 'fact', title: '标题', content: '内容',
    });
    expect(draft.id).toMatch(/^ev_[a-f0-9]{8}$/);
    expect(draft.status).toBe('draft');

    const confirmed = await evidence.confirm(draft.id);
    expect(confirmed?.status).toBe('confirmed');
    expect(await evidence.confirm(draft.id)).toBeNull();
    expect(await evidence.confirm('ev_00000000')).toBeNull();
  });

  it('list 可按线程过滤', async () => {
    const { evidence } = createMemoryStores();
    await evidence.createDraft({ threadId: 't1', kind: 'fact', title: 'a', content: 'a' });
    await evidence.createDraft({ threadId: 't2', kind: 'lesson', title: 'b', content: 'b' });
    expect((await evidence.list('t1')).length).toBe(1);
    expect((await evidence.list()).length).toBe(2);
    expect((await evidence.get('不存在的id'))).toBeNull();
  });
});

describe('内存 Approval 存储', () => {
  it('create → approve → markApplied 状态流转', async () => {
    const { approvals } = createMemoryStores();
    const card = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: '1 file changed',
    });
    expect(card.id).toMatch(/^ap_[a-f0-9]{8}$/);
    expect(card.status).toBe('draft');

    const approved = await approvals.approve(card.id);
    expect(approved?.status).toBe('approved');
    expect(await approvals.approve(card.id)).toBeNull();

    const applied = await approvals.markApplied(card.id);
    expect(applied?.status).toBe('applied');
  });

  it('reject 带理由;list 按线程过滤;setReviewComment', async () => {
    const { approvals } = createMemoryStores();
    const card = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: 's',
    });
    const reviewed = await approvals.setReviewComment(card.id, '审查意见');
    expect(reviewed?.status).toBe('reviewing');
    expect(reviewed?.reviewComment).toBe('审查意见');

    const rejected = await approvals.reject(card.id, '理由');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectReason).toBe('理由');
    expect(await approvals.reject(card.id, 'x')).toBeNull();
    expect((await approvals.list('t1')).length).toBe(1);
    expect(await approvals.get('ap_00000000')).toBeNull();
  });
});
