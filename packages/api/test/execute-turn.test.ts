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

describe('executeTurn 消息协议与注入', () => {
  it('#confirm 确认 draft:回执且不调 agent', async () => {
    const stores = createMemoryStores();
    let agentCalled = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          agentCalled = true;
          return { sessionId: '', content: '', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const draft = await stores.evidence.createDraft({
      threadId: thread.id, kind: 'fact', title: '好结论', content: '内容',
    });
    const final = await executeTurn({
      threadId: thread.id,
      content: `#confirm ${draft.id}`,
      context: { stores, registry },
    });
    expect(agentCalled).toBe(false);
    expect(final.role).toBe('system');
    expect(final.content).toContain('✅ 已沉淀:好结论');
    expect((await stores.evidence.get(draft.id))?.status).toBe('confirmed');
  });

  it('#confirm 无效 id:回执警告', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', 'x')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id, content: '#confirm ev_00000000', context: { stores, registry },
    });
    expect(final.role).toBe('system');
    expect(final.content).toContain('⚠️');
  });

  it('#learn 完成轮生成 draft + 建议消息', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '这是重要结论')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '#learn 团队约定', context: { stores, registry },
    });
    const drafts = await stores.evidence.list(thread.id);
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.title).toBe('团队约定');
    expect(drafts[0]?.content).toBe('这是重要结论');
    expect(drafts[0]?.status).toBe('draft');
    const messages = await stores.messages.list(thread.id);
    const suggestion = messages.find((m) => m.role === 'system');
    expect(suggestion?.content).toContain('💡 建议沉淀为证据:「团队约定」');
    expect(suggestion?.content).toContain(`#confirm ${drafts[0]?.id}`);
  });

  it('#ev_ 引用注入 systemPrompt', async () => {
    const stores = createMemoryStores();
    let receivedPrompt: string | undefined;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          receivedPrompt = input.systemPrompt;
          return { sessionId: 'sess-new', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const entry = await stores.evidence.createDraft({
      threadId: thread.id, kind: 'fact', title: '关键事实', content: '事实内容',
    });
    await stores.evidence.confirm(entry.id);
    await executeTurn({
      threadId: thread.id, content: `用 #ev_${entry.id.slice(3)}`, context: { stores, registry },
    });
    expect(receivedPrompt).toContain('团队记忆');
    expect(receivedPrompt).toContain('关键事实: 事实内容');
  });

  it('新会话注入 profile;resume 不注入', async () => {
    const stores = createMemoryStores();
    const prompts: (string | undefined)[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.systemPrompt);
          return { sessionId: 'sess-1', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.profiles.create({
      agentId: 'claude', name: '墨墨', personality: '沉稳', role: '写手', expertise: ['TS'],
    });
    // 第一轮:新会话,应注入
    await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    expect(prompts[0]).toContain('你是 墨墨');
    // 第二轮:已有 session,不注入
    await executeTurn({ threadId: thread.id, content: 'hi again', context: { stores, registry } });
    expect(prompts[1]).toBeUndefined();
  });

  it('#learn 失败轮不生成 draft', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: '', content: '', status: 'failed', error: 'boom' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '#learn 不该沉淀', context: { stores, registry },
    });
    expect((await stores.evidence.list(thread.id)).length).toBe(0);
  });
});
