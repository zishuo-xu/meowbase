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

  it('setSession 更新会话映射', async () => {
    const { threads } = createMemoryStores();
    const thread = await threads.create({ title: 't', primaryAgentId: 'claude' });
    await threads.setSession(thread.id, 'claude', 'sess-1');
    const updated = await threads.get(thread.id);
    expect(updated?.sessions.claude).toBe('sess-1');
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
