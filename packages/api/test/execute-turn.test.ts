import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';
import { executeTurn } from '../src/router/execute-turn.js';

function stubAgent(agentId: AgentId, reply: string, sessionId = `sess-${agentId}`): AgentService {
  return {
    agentId,
    async runTurn(input) {
      // 逐字符发增量,便于断言流式累积结果
      for (const piece of reply) {
        input.onIncrement?.(piece);
      }
      return { sessionId, content: reply, status: 'completed' };
    },
  };
}

describe('executeTurn', () => {
  it('按 @mention 路由到指定 agent', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      stubAgent('claude', 'claude 干的'),
      stubAgent('gemini', 'gemini 干的'),
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id,
      content: '@gemini 你来',
      context: { stores, registry },
    });
    expect(final.content).toBe('gemini 干的');
    expect(final.agentId).toBe('gemini');
    expect(final.status).toBe('completed');
  });

  it('无 mention 走 primaryAgentId', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '默认')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id,
      content: '随便',
      context: { stores, registry },
    });
    expect(final.content).toBe('默认');
  });

  it('流式增量累积并触发 onIncrement', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '一二三')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const increments: string[] = [];
    const final = await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: {
        stores,
        registry,
        onIncrement: (_tid, _mid, delta) => increments.push(delta),
      },
    });
    expect(increments.join('')).toBe('一二三');
    expect(final.content).toBe('一二三');
    // 流式期间消息已逐段落库
    const messages = await stores.messages.list(thread.id);
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('一二三');
    expect(assistant?.sessionId).toBe('sess-claude');
  });

  it('新会话 ID 会写回线程', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', 'ok', 'sess-new-1')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    expect((await stores.threads.get(thread.id))?.sessions.claude).toBe('sess-new-1');
  });

  it('provider 失败时消息标记 failed 并带错误', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: '', content: '部分输出', status: 'failed', error: 'boom' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    expect(final.status).toBe('failed');
    expect(final.error).toBe('boom');
  });

  it('线程不存在时抛错', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', 'x')]);
    await expect(
      executeTurn({ threadId: 'no-such', content: 'hi', context: { stores, registry } }),
    ).rejects.toThrow('线程不存在');
  });
});
