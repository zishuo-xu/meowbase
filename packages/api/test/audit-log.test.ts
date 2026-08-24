import { describe, expect, it } from 'vitest';
import { clipAuditSubject } from '@meowbase/shared';
import { createMemoryStores } from '../src/stores/factories.js';
import { auditApprovals, auditMessages } from '../src/stores/audit-log.js';
import type { AuditStore } from '../src/stores/ports.js';

function throwingAudit(): AuditStore {
  return {
    async append() {
      throw new Error('audit boom');
    },
    async list() {
      return [];
    },
  };
}

describe('auditMessages 装饰器', () => {
  it('系统消息 action 等于 systemKind,subject 是截断摘要不是全文', async () => {
    const raw = createMemoryStores();
    const messages = auditMessages(raw.messages, raw.audit);
    const longTail = '后面还有很长很长的正文。'.repeat(30);
    const content = `🤝 接力:墨墨 → 闪闪\n${longTail}`;
    const saved = await messages.append({
      threadId: 't-kind',
      role: 'system',
      content,
      status: 'completed',
      systemKind: 'relay',
      systemMeta: { from: 'claude', to: 'gemini' },
    });
    const rows = await raw.audit.list({ threadId: 't-kind' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('relay');
    expect(rows[0]?.actor).toBe('platform');
    expect(rows[0]?.subject).toBe(clipAuditSubject(content));
    expect(rows[0]?.subject).not.toContain(longTail.slice(0, 20));
    expect(JSON.stringify(rows[0])).not.toContain(content);
    expect(rows[0]?.meta).toMatchObject({
      messageId: saved.id,
      from: 'claude',
      to: 'gemini',
    });
  });

  it('人发言记 user-say;助手占位不记', async () => {
    const raw = createMemoryStores();
    const messages = auditMessages(raw.messages, raw.audit);
    await messages.append({
      threadId: 't-roles',
      role: 'user',
      content: '@墨墨 写 add.ts',
      status: 'completed',
    });
    await messages.append({
      threadId: 't-roles',
      role: 'assistant',
      agentId: 'claude',
      content: '',
      status: 'streaming',
    });
    const rows = await raw.audit.list({ threadId: 't-roles' });
    expect(rows.map((r) => r.action)).toEqual(['user-say']);
    expect(rows[0]?.actor).toBe('human');
  });

  it('audit.append 抛异常时业务 append 仍成功', async () => {
    const raw = createMemoryStores();
    const messages = auditMessages(raw.messages, throwingAudit());
    const saved = await messages.append({
      threadId: 't-boom',
      role: 'user',
      content: '还在',
      status: 'completed',
    });
    expect(saved.content).toBe('还在');
    expect(await raw.messages.get('t-boom', saved.id)).toEqual(saved);
  });

  it('patch 成 completed 记 hop-done 且带 usage;failed 记 hop-failed', async () => {
    const raw = createMemoryStores();
    const messages = auditMessages(raw.messages, raw.audit);
    const streaming = await messages.append({
      threadId: 't-patch',
      role: 'assistant',
      agentId: 'claude',
      content: '',
      status: 'streaming',
      hopId: 'hop-1',
    });
    const done = await messages.patch('t-patch', streaming.id, {
      content: '写完了',
      status: 'completed',
      usage: { inputTokens: 9, outputTokens: 4 },
    });
    expect(done.status).toBe('completed');
    const failed = await messages.append({
      threadId: 't-patch',
      role: 'assistant',
      agentId: 'gemini',
      content: '半截',
      status: 'streaming',
      hopId: 'hop-2',
    });
    await messages.patch('t-patch', failed.id, { status: 'failed', error: '平台重启' });

    const rows = await raw.audit.list({ threadId: 't-patch' });
    expect(rows.map((r) => r.action)).toEqual(['hop-failed', 'hop-done']);
    const hopDone = rows.find((r) => r.action === 'hop-done');
    expect(hopDone?.actor).toBe('claude');
    expect(hopDone?.meta).toMatchObject({
      messageId: streaming.id,
      hopId: 'hop-1',
      usage: { inputTokens: 9, outputTokens: 4 },
    });
    expect(rows.find((r) => r.action === 'hop-failed')?.actor).toBe('gemini');
  });
});

describe('auditApprovals 装饰器', () => {
  it('create / approve / reject / markApplied 各一行', async () => {
    const raw = createMemoryStores();
    const approvals = auditApprovals(raw.approvals, raw.audit);
    const card = await approvals.create({
      threadId: 't-ap',
      writerAgentId: 'claude',
      reviewerAgentId: 'gemini',
      diffText: 'diff',
      diffStat: '1 file changed',
    });
    await approvals.approve(card.id);
    await approvals.markApplied(card.id);

    const other = await approvals.create({
      threadId: 't-ap',
      writerAgentId: 'opencode',
      reviewerAgentId: 'gemini',
      diffText: 'd2',
      diffStat: '2 files',
    });
    await approvals.reject(other.id, '不行');

    const rows = await raw.audit.list({ threadId: 't-ap' });
    expect(rows.map((r) => r.action)).toEqual([
      'approval-rejected',
      'approval-created',
      'approval-applied',
      'approval-approved',
      'approval-created',
    ]);
    expect(rows.every((r) => r.actor === 'platform')).toBe(true);
    expect(rows.find((r) => r.action === 'approval-approved')?.meta).toMatchObject({
      approvalId: card.id,
    });
  });

  it('void 落一行 approval-voided,带原因,失败不落', async () => {
    const raw = createMemoryStores();
    const approvals = auditApprovals(raw.approvals, raw.audit);
    const card = await approvals.create({
      threadId: 't-void',
      writerAgentId: 'claude',
      reviewerAgentId: 'gemini',
      diffText: 'diff',
      diffStat: '1 file changed',
    });
    await approvals.setReviewComment(card.id, '通过');
    await approvals.void(card.id, 'PR #12 已合并');
    expect(await approvals.void(card.id, '再废')).toBeNull();

    const rows = (await raw.audit.list({ threadId: 't-void' })).filter(
      (r) => r.action === 'approval-voided',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meta).toMatchObject({
      approvalId: card.id,
      voidReason: 'PR #12 已合并',
    });
  });

  it('批准成功只落一条 approval-applied,带 approvalId;回执消息不重复落', async () => {
    const raw = createMemoryStores();
    const messages = auditMessages(raw.messages, raw.audit);
    const approvals = auditApprovals(raw.approvals, raw.audit);
    const card = await approvals.create({
      threadId: 't-once',
      writerAgentId: 'claude',
      reviewerAgentId: 'gemini',
      diffText: 'diff',
      diffStat: '1 file changed',
    });
    await approvals.approve(card.id);
    await approvals.markApplied(card.id);
    await messages.append({
      threadId: 't-once',
      role: 'system',
      content: `✅ 已批准并落地:${card.id}`,
      status: 'completed',
      systemKind: 'approval-applied',
    });
    const applied = (await raw.audit.list({ threadId: 't-once' })).filter(
      (r) => r.action === 'approval-applied',
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]?.meta).toMatchObject({ approvalId: card.id });
  });

  it('approval-failed 仍从消息派生', async () => {
    const raw = createMemoryStores();
    const messages = auditMessages(raw.messages, raw.audit);
    await messages.append({
      threadId: 't-fail',
      role: 'system',
      content: '⚠️ 批准记下了，但提交失败：index.lock',
      status: 'completed',
      systemKind: 'approval-failed',
    });
    const rows = await raw.audit.list({ threadId: 't-fail' });
    expect(rows.map((r) => r.action)).toEqual(['approval-failed']);
    expect(rows[0]?.subject).toContain('提交失败');
  });
});

describe('auditMessages 判别联合透传', () => {
  it('把 append input 原样交给底层,不重拼对象', async () => {
    const raw = createMemoryStores();
    const seen: unknown[] = [];
    const inner = {
      append: async (input: Parameters<typeof raw.messages.append>[0]) => {
        seen.push(input);
        return raw.messages.append(input);
      },
      get: raw.messages.get.bind(raw.messages),
      list: raw.messages.list.bind(raw.messages),
      deleteAll: raw.messages.deleteAll.bind(raw.messages),
      patch: raw.messages.patch.bind(raw.messages),
    };
    const messages = auditMessages(inner, raw.audit);
    const input = {
      threadId: 't-pass',
      role: 'system' as const,
      content: '球掉地上了',
      status: 'completed' as const,
      systemKind: 'dropped' as const,
    };
    await messages.append(input);
    expect(seen[0]).toBe(input);
  });
});
