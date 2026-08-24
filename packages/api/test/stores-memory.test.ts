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

  it('lastApprovedSha 写入后 get 能 round-trip', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({
      title: '绑仓',
      primaryAgentId: 'claude',
      repo: { path: '/src/myapp', baseBranch: 'main' },
    });
    expect(thread.repo?.lastApprovedSha).toBeUndefined();
    await threads.setLastApprovedSha(thread.id, 'abc123def456');
    expect((await threads.get(thread.id))?.repo?.lastApprovedSha).toBe('abc123def456');
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

  it('clearPendingHopIfSame:同 id 才清,不同 id 不动槽', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: 'clear', primaryAgentId: 'claude' });
    const hop = {
      id: 'hop-a',
      to: 'opencode' as const,
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
    expect((await threads.get(thread.id))?.pendingHop?.id).toBe('hop-a');
    expect(await threads.clearPendingHopIfSame(thread.id, 'hop-a')).toBe(true);
    expect((await threads.get(thread.id))?.pendingHop).toBeUndefined();
    expect(await threads.clearPendingHopIfSame(thread.id, 'hop-a')).toBe(false);
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

  it('forceClaimPendingHop 覆盖别人的租约,新主人能续旧主人不能', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: 'force-lease', primaryAgentId: 'claude' });
    expect(await threads.claimPendingHop(thread.id, 'old-runner', 60_000)).toBe(true);
    await threads.forceClaimPendingHop(thread.id, 'new-runner', 60_000);
    expect(await threads.renewPendingHopLease(thread.id, 'old-runner', 60_000)).toBe(false);
    expect(await threads.renewPendingHopLease(thread.id, 'new-runner', 60_000)).toBe(true);
    expect(await threads.claimPendingHop(thread.id, 'third', 60_000)).toBe(false);
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

  it('系统消息 round-trip 保留 systemKind/systemMeta', async () => {
    const { threads, messages } = createMemoryStores();
    const thread = await threads.create({ title: 't', primaryAgentId: 'claude' });
    const m = await messages.append({
      threadId: thread.id,
      role: 'system',
      content: '🤝 接力:墨墨 → 团团',
      status: 'completed',
      systemKind: 'relay',
      systemMeta: { from: 'claude', to: 'opencode' },
    });
    expect(m.systemKind).toBe('relay');
    expect(m.systemMeta).toEqual({ from: 'claude', to: 'opencode' });
    expect(await messages.get(thread.id, m.id)).toEqual(m);
    expect((await messages.list(thread.id))[0]?.systemKind).toBe('relay');
    expect((await messages.list(thread.id))[0]?.systemMeta).toEqual({ from: 'claude', to: 'opencode' });
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

  it('void 只吃还开着的卡(含 approved),终态拒并原样留下', async () => {
    const { approvals } = createMemoryStores();
    const open = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: 's',
    });
    const reviewing = await approvals.setReviewComment(open.id, '通过');
    expect(reviewing?.status).toBe('reviewing');

    const voided = await approvals.void(open.id, 'PR #12 已合并');
    expect(voided?.status).toBe('voided');
    expect(voided?.voidReason).toBe('PR #12 已合并');
    expect(await approvals.void(open.id, '再废一次')).toBeNull();
    expect((await approvals.get(open.id))?.status).toBe('voided');

    const draft = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd2', diffStat: 's2',
    });
    expect((await approvals.void(draft.id, 'PR #13 已合并'))?.status).toBe('voided');

    // approved 也算「还开着」:人批了但提交失败的卡停在这里,而 `#approve` 打上去会再走
    // 一遍落地——改动已经进基准分支之后,那次重试必然 nothing to commit 失败。
    const approved = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd3', diffStat: 's3',
    });
    await approvals.approve(approved.id);
    expect((await approvals.void(approved.id, 'PR #14 已合并'))?.status).toBe('voided');

    const applied = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd4', diffStat: 's4',
    });
    await approvals.approve(applied.id);
    await approvals.markApplied(applied.id);
    expect(await approvals.void(applied.id, 'PR #15 已合并')).toBeNull();
    expect((await approvals.get(applied.id))?.status).toBe('applied');

    const rejected = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd5', diffStat: 's5',
    });
    await approvals.reject(rejected.id, '不行');
    expect(await approvals.void(rejected.id, 'PR #16 已合并')).toBeNull();
    expect((await approvals.get(rejected.id))?.status).toBe('rejected');
    expect(await approvals.get('ap_00000000').then((c) => c && approvals.void(c.id, 'x'))).toBeNull();
    expect(await approvals.void('ap_00000000', 'x')).toBeNull();
  });
});
