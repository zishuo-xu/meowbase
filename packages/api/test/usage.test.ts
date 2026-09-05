import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@meowbase/shared';
import { totalTokensOf } from '@meowbase/shared';
import { createMemoryStores } from '../src/stores/factories.js';
import { loadToolUsage, loadUsage, sumUsage } from '../src/services/usage.js';

function msg(partial: Pick<Message, 'role' | 'status'> & Partial<Message>): Message {
  return {
    id: partial.id ?? 'm',
    threadId: partial.threadId ?? 't',
    content: partial.content ?? '',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('sumUsage', () => {
  it('只算 assistant + completed', () => {
    const counted = sumUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: { inputTokens: 10 },
      }),
    ]);
    expect(counted.byAgent.claude?.inputTokens).toBe(10);
    expect(counted.total.inputTokens).toBe(10);
  });

  it('streaming 不算', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'streaming',
        agentId: 'claude',
        usage: { inputTokens: 99 },
      }),
    ]);
    expect(result.byAgent.claude).toBeUndefined();
    expect(result.total).toEqual({});
  });

  it('failed 不算', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'failed',
        agentId: 'claude',
        usage: { inputTokens: 99, costUsd: 1 },
      }),
    ]);
    expect(result.byAgent.claude).toBeUndefined();
    expect(result.total).toEqual({});
  });

  it('terminated 不算', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'terminated',
        agentId: 'claude',
        usage: { inputTokens: 99 },
      }),
    ]);
    expect(result.byAgent.claude).toBeUndefined();
    expect(result.total).toEqual({});
  });

  it('user 不算', () => {
    const result = sumUsage([
      msg({
        role: 'user',
        status: 'completed',
        usage: { inputTokens: 99 },
      }),
    ]);
    expect(result.byAgent).toEqual({});
    expect(result.total).toEqual({});
  });

  it('system 不算', () => {
    const result = sumUsage([
      msg({
        role: 'system',
        status: 'completed',
        systemKind: 'notice',
        usage: { inputTokens: 99 },
      }),
    ]);
    expect(result.byAgent).toEqual({});
    expect(result.total).toEqual({});
  });

  it('多条消息累加,缓存字段也累加', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          cacheReadTokens: 3,
          cacheCreationTokens: 2,
        },
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: {
          inputTokens: 20,
          outputTokens: 6,
          totalTokens: 26,
          cacheReadTokens: 5,
          cacheCreationTokens: 1,
        },
      }),
    ]);
    expect(result.byAgent.claude).toEqual({
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      cacheReadTokens: 8,
      cacheCreationTokens: 3,
    });
    expect(result.total).toEqual(result.byAgent.claude);
  });

  it('按 agentId 分组,没用量的猫不出现在 byAgent', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: { inputTokens: 7 },
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'gemini',
        content: '没有 usage 字段',
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'opencode',
        usage: { outputTokens: 2 },
      }),
    ]);
    expect(Object.keys(result.byAgent).sort()).toEqual(['claude', 'opencode']);
    expect(result.byAgent.gemini).toBeUndefined();
    expect(result.byAgent.claude?.inputTokens).toBe(7);
    expect(result.byAgent.opencode?.outputTokens).toBe(2);
  });

  it('costUsd 只在存在时累加', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: { inputTokens: 1, costUsd: 0.01 },
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'gemini',
        usage: { inputTokens: 2 },
      }),
    ]);
    expect(result.byAgent.claude?.costUsd).toBe(0.01);
    expect(result.byAgent.gemini?.costUsd).toBeUndefined();
    expect(result.total.costUsd).toBe(0.01);
    expect(result.total.inputTokens).toBe(3);
  });

  it('有一条带 costEstimated 时结果里带标记', () => {
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: { costUsd: 0.01 },
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'opencode',
        usage: { costUsd: 0.02, costEstimated: true },
      }),
    ]);
    expect(result.byAgent.opencode?.costEstimated).toBe(true);
    expect(result.total.costEstimated).toBe(true);
    expect(result.total.costUsd).toBeCloseTo(0.03);
  });

  it('真实交棒链: total.totalTokens 是每只猫派生后再相加,不小于 inputTokens', () => {
    const claude = {
      inputTokens: 21171,
      outputTokens: 1936,
      cacheReadTokens: 107008,
      cacheCreationTokens: 0,
      costUsd: 0.207759,
    };
    const gemini = {
      inputTokens: 179,
      outputTokens: 557,
      totalTokens: 13465,
      cacheReadTokens: 10880,
      costEstimated: false,
    };
    const result = sumUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        usage: claude,
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'gemini',
        usage: gemini,
      }),
    ]);
    expect(result.byAgent.claude).toEqual(claude);
    expect(result.byAgent.gemini).toEqual(gemini);
    expect(result.total.totalTokens).toBeGreaterThanOrEqual(result.total.inputTokens ?? 0);
    expect(result.total.totalTokens).toBe(totalTokensOf(claude) + totalTokensOf(gemini));
  });
});

describe('loadUsage', () => {
  it('跨线程只 list 每条线程,不逐条 get', async () => {
    const stores = createMemoryStores();
    const a = await stores.threads.create({ title: 'A', primaryAgentId: 'claude' });
    const b = await stores.threads.create({ title: 'B', primaryAgentId: 'gemini' });
    await stores.messages.append({
      threadId: a.id,
      role: 'assistant',
      agentId: 'claude',
      content: 'a',
      status: 'completed',
      usage: { inputTokens: 1 },
    });
    await stores.messages.append({
      threadId: b.id,
      role: 'assistant',
      agentId: 'gemini',
      content: 'b',
      status: 'completed',
      usage: { inputTokens: 2 },
    });
    const listSpy = vi.spyOn(stores.messages, 'list');
    const getSpy = vi.spyOn(stores.messages, 'get');

    const result = await loadUsage(stores);
    expect(result.total.inputTokens).toBe(3);
    expect(getSpy).not.toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenCalledWith(a.id);
    expect(listSpy).toHaveBeenCalledWith(b.id);
  });

  it('给了 threadId 只 list 这一条', async () => {
    const stores = createMemoryStores();
    const a = await stores.threads.create({ title: 'A', primaryAgentId: 'claude' });
    const b = await stores.threads.create({ title: 'B', primaryAgentId: 'gemini' });
    await stores.messages.append({
      threadId: a.id,
      role: 'assistant',
      agentId: 'claude',
      content: 'a',
      status: 'completed',
      usage: { inputTokens: 1 },
    });
    await stores.messages.append({
      threadId: b.id,
      role: 'assistant',
      agentId: 'gemini',
      content: 'b',
      status: 'completed',
      usage: { inputTokens: 2 },
    });
    const listSpy = vi.spyOn(stores.messages, 'list');

    const result = await loadUsage(stores, a.id);
    expect(result.total.inputTokens).toBe(1);
    expect(result.byAgent.gemini).toBeUndefined();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith(a.id);
  });
});

describe('loadToolUsage', () => {
  it('跨线程合计技能注入和工具调用', async () => {
    const stores = createMemoryStores();
    const a = await stores.threads.create({ title: 'A', primaryAgentId: 'claude' });
    const b = await stores.threads.create({ title: 'B', primaryAgentId: 'gemini' });
    await stores.messages.append({
      threadId: a.id,
      role: 'assistant',
      agentId: 'claude',
      content: 'a',
      status: 'completed',
      skillIds: ['review'],
      activities: [{ id: 't1', name: 'Write', status: 'done' }],
    });
    await stores.messages.append({
      threadId: b.id,
      role: 'assistant',
      agentId: 'gemini',
      content: 'b',
      status: 'completed',
      skillIds: ['review', 'tdd'],
      activities: [{ id: 't2', name: 'mcp__github__search', status: 'done' }],
    });
    const all = await loadToolUsage(stores);
    expect(all.skills).toEqual([
      { id: 'review', count: 2 },
      { id: 'tdd', count: 1 },
    ]);
    expect(all.tools.map((row) => row.name).sort()).toEqual(['Write', 'mcp__github__search']);
    expect(all.total).toEqual({ skillInjections: 3, toolCalls: 2 });

    const one = await loadToolUsage(stores, a.id);
    expect(one.skills).toEqual([{ id: 'review', count: 1 }]);
    expect(one.tools).toEqual([{ name: 'Write', category: 'builtin', count: 1 }]);
  });
});
