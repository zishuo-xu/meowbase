import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn, followPendingChain } from '../src/router/execute-turn.js';
import { auditApprovals, auditMessages } from '../src/stores/audit-log.js';

function withAudit(raw: ReturnType<typeof createMemoryStores>) {
  return {
    ...raw,
    messages: auditMessages(raw.messages, raw.audit),
    approvals: auditApprovals(raw.approvals, raw.audit),
  };
}

describe('审计流水集成', () => {
  it('交棒链动作顺序是 user-say → hop-done → relay → …', async () => {
    const raw = createMemoryStores();
    const stores = withAudit(raw);
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return {
            sessionId: 's1',
            content: '方案已经写在上面:先落地加法函数并导出,再补零、负数和小数的边界测试,最后接到现有入口,不要顺手改无关文件,也不要另开一条。\n写完了。\n@opencode 请审查',
            status: 'completed',
            usage: { inputTokens: 4, outputTokens: 6 },
          };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          return {
            sessionId: 's2',
            content: '审查通过',
            status: 'completed',
            usage: { inputTokens: 2, outputTokens: 3 },
          };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const ctx = { stores, registry };
    await executeTurn({ threadId: thread.id, content: '@claude 写代码', context: ctx });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const actions = (await raw.audit.list({ threadId: thread.id })).map((r) => r.action).reverse();
    const start = actions.slice(0, 3);
    expect(start).toEqual(['user-say', 'hop-done', 'relay']);
    expect(actions).toContain('hop-done');
    expect(actions.indexOf('relay')).toBeGreaterThan(actions.indexOf('user-say'));
    expect(actions.lastIndexOf('hop-done')).toBeGreaterThan(actions.indexOf('relay'));
  });
});
