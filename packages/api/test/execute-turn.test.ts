import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';
import { executeTurn, followPendingChain, MAX_REVIEW_FIX_ROUNDS } from '../src/router/execute-turn.js';
import { cloneAgentSpec, DEFAULT_AGENTS } from '../src/config.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitInit } from '../src/services/git.js';

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

  it('句中不要 @闪闪 不并行叫闪闪', async () => {
    const stores = createMemoryStores();
    const called: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          called.push('claude');
          return { sessionId: 's1', content: '只写 add', status: 'completed' };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          called.push('gemini');
          return { sessionId: 's2', content: '不该来', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '不要 @闪闪,只写 add.ts',
      context: { stores, registry },
    });
    expect(called).toEqual(['claude']);
  });

  it('首条用户消息把占位标题换成任务摘要', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '好')]);
    const thread = await stores.threads.create({ title: '8/17 19:28', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 在沙箱写 add.ts',
      context: { stores, registry },
    });
    expect((await stores.threads.get(thread.id))?.title).toBe('在沙箱写 add.ts');
    await executeTurn({
      threadId: thread.id,
      content: '再改一下',
      context: { stores, registry },
    });
    expect((await stores.threads.get(thread.id))?.title).toBe('在沙箱写 add.ts');
  });

  it('人手起的标题不被首条消息覆盖', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '好')]);
    const thread = await stores.threads.create({ title: '验证球权', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '你是谁',
      context: { stores, registry },
    });
    expect((await stores.threads.get(thread.id))?.title).toBe('验证球权');
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

  it('没 @ 续最近用户点过的猫', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      stubAgent('claude', '墨墨'),
      stubAgent('gemini', '闪闪接着干'),
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '@闪闪 你来',
      context: { stores, registry },
    });
    const final = await executeTurn({
      threadId: thread.id,
      content: '继续',
      context: { stores, registry },
    });
    expect(final.agentId).toBe('gemini');
    expect(final.content).toBe('闪闪接着干');
  });

  it('用户也没 @ 时续最后开口的猫', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      stubAgent('claude', '主猫'),
      stubAgent('opencode', '团团接着'),
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.messages.append({
      threadId: thread.id,
      role: 'assistant',
      agentId: 'opencode',
      content: '上一棒是我',
      status: 'completed',
    });
    const final = await executeTurn({
      threadId: thread.id,
      content: '接着说',
      context: { stores, registry },
    });
    expect(final.agentId).toBe('opencode');
    expect(final.content).toBe('团团接着');
  });

  it('中止本轮后停棒并提示球还在地上', async () => {
    const stores = createMemoryStores();
    const hang: AgentService = {
      agentId: 'claude',
      async runTurn(input) {
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            resolve();
            return;
          }
          input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return { sessionId: 's', content: '', status: 'terminated', error: '已中止' };
      },
    };
    const registry = createAgentRegistry([hang]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const ac = new AbortController();
    const pending = executeTurn({
      threadId: thread.id,
      content: '先做这个',
      context: { stores, registry, signal: ac.signal },
    });
    ac.abort();
    const final = await pending;
    expect(final.status).toBe('terminated');
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(true);
  });

  it('CLI 失败后停棒并提示球还在地上', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return {
            sessionId: 's',
            content: '',
            status: 'failed',
            error: 'opencode 退出码 1: hosted in China',
          };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id,
      content: '写 add.ts',
      context: { stores, registry },
    });
    expect(final.status).toBe('failed');
    const messages = await stores.messages.list(thread.id);
    const note = messages.find((m) => m.role === 'system' && m.content.includes('球还在地上'));
    expect(note?.content).toContain('失败');
  });

  it('流式增量累积并触发 onIncrement', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '一二三')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const increments: string[] = [];
    const starts: string[] = [];
    const final = await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: {
        stores,
        registry,
        onIncrement: (_tid, _mid, delta) => increments.push(delta),
        onStart: (_tid, messageId, agentId) => starts.push(`${agentId}:${messageId}`),
      },
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]?.startsWith('claude:')).toBe(true);
    expect(increments.join('')).toBe('一二三');
    expect(final.content).toBe('一二三');
    // 流式期间消息已逐段落库
    const messages = await stores.messages.list(thread.id);
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('一二三');
    expect(assistant?.sessionId).toBe('sess-claude');
  });

  it('工具过程经 onActivity 推送并落库', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          input.onActivity?.({ id: 't1', name: 'Write', arg: 'add.js', status: 'running' });
          input.onIncrement?.('写好了');
          input.onActivity?.({ id: 't1', name: 'tool', status: 'done' });
          return { sessionId: 'sess-claude', content: '写好了', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const seen: Array<{ name: string; status: string }> = [];
    const final = await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: {
        stores,
        registry,
        onActivity: (_tid, _mid, activity) => seen.push({ name: activity.name, status: activity.status }),
      },
    });
    expect(seen).toEqual([
      { name: 'Write', status: 'running' },
      { name: 'Write', status: 'done' },
    ]);
    expect(final.activities).toEqual([{ id: 't1', name: 'Write', arg: 'add.js', status: 'done' }]);
  });

  it('思考过程经 onThinking 推送并落库,不进 CLI 工具', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          input.onThinking?.('先看目录');
          input.onActivity?.({ id: 't1', name: 'Read', arg: 'a.ts', status: 'done' });
          input.onIncrement?.('写好了');
          return { sessionId: 'sess-claude', content: '写好了', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const thoughts: string[] = [];
    const final = await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: {
        stores,
        registry,
        onThinking: (_tid, _mid, delta) => thoughts.push(delta),
      },
    });
    expect(thoughts.join('')).toBe('先看目录');
    expect(final.thinking).toBe('先看目录');
    expect(final.content).toBe('写好了');
    expect(final.activities?.some((a) => a.name === '思考')).toBeFalsy();
  });

  it('超时后把未完成的工具标成 error', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          input.onActivity?.({ id: 't1', name: 'read', arg: 'a.ts', status: 'running' });
          return {
            sessionId: 'sess-claude',
            content: '',
            status: 'terminated',
            error: 'opencode 执行超时(300000ms)',
          };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: { stores, registry },
    });
    expect(final.status).toBe('terminated');
    expect(final.activities).toEqual([{ id: 't1', name: 'read', arg: 'a.ts', status: 'error' }]);
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

  it('说之前约定时按关键词召回已确认证据,含跨线程', async () => {
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
    const other = await stores.threads.create({ title: 'old', primaryAgentId: 'claude' });
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const hit = await stores.evidence.createDraft({
      threadId: other.id, kind: 'decision', title: '用户偏好 TypeScript', content: '喜欢 TypeScript',
    });
    const miss = await stores.evidence.createDraft({
      threadId: other.id, kind: 'fact', title: 'LRU 容量', content: '默认 16',
    });
    await stores.evidence.confirm(hit.id);
    await stores.evidence.confirm(miss.id);
    await executeTurn({
      threadId: thread.id,
      content: '之前我们约定用 TypeScript,按那个来',
      context: { stores, registry },
    });
    expect(receivedPrompt).toContain('团队记忆');
    expect(receivedPrompt).toContain('用户偏好 TypeScript');
    expect(receivedPrompt).not.toContain('LRU 容量');
  });

  it('星星罐子整行停棒,不调 agent', async () => {
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
    const final = await executeTurn({
      threadId: thread.id,
      content: '星星罐子',
      context: { stores, registry },
    });
    expect(agentCalled).toBe(false);
    expect(final.role).toBe('system');
    expect(final.content).toContain('已拉闸');
    expect(final.content).toContain('星星罐子');
  });

  it('新会话和 resume 都注入身份与交接规则', async () => {
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
    await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    expect(prompts[0]).toContain('你是 墨墨');
    expect(prompts[0]).toContain('交接规则');
    await executeTurn({ threadId: thread.id, content: 'hi again', context: { stores, registry } });
    expect(prompts[1]).toContain('你是 墨墨');
    expect(prompts[1]).toContain('交接规则');
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

describe('executeTurn 技能注入', () => {
  const reviewSkill = {
    id: 'review',
    name: '代码审查',
    description: 'd',
    triggers: ['review', '审查'],
    prompt: '按清单审查:正确性、边界、可读性',
  };

  it('命中触发词 → systemPrompt 含技能;不命中 → 不含', async () => {
    const stores = createMemoryStores([reviewSkill]);
    const prompts: (string | undefined)[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.systemPrompt);
          return { sessionId: 's1', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });

    // 第一轮:命中 review 触发词
    await executeTurn({
      threadId: thread.id, content: '帮我 review 这段代码', context: { stores, registry },
    });
    expect(prompts[0]).toContain('[技能:代码审查]');
    expect(prompts[0]).toContain('按清单审查');

    // 第二轮:无触发词,不注入技能,但仍有交接规则
    await executeTurn({ threadId: thread.id, content: '继续', context: { stores, registry } });
    expect(prompts[1]).not.toContain('[技能:');
    expect(prompts[1]).toContain('交接规则');
  });

  it('多技能命中时全部注入', async () => {
    const stores = createMemoryStores([
      reviewSkill,
      { id: 'debug', name: '系统化调试', description: 'd', triggers: ['debug'], prompt: '先复现再修复' },
    ]);
    let received: string | undefined;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          received = input.systemPrompt;
          return { sessionId: 's1', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '先 review 再 debug', context: { stores, registry },
    });
    expect(received).toContain('[技能:代码审查]');
    expect(received).toContain('[技能:系统化调试]');
  });
});

describe('executeTurn 审批流', () => {
  const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-approval-'));
  const reviewSkill = {
    id: 'review', name: '代码审查', description: 'd', triggers: ['review'], prompt: '审查清单',
  };

  async function makeGitThread(stores: ReturnType<typeof createMemoryStores>) {
    const thread = await stores.threads.create({
      title: 't', primaryAgentId: 'claude', workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);
    return thread;
  }

  it('完成轮有 diff → 创建卡片并自动审查', async () => {
    const stores = createMemoryStores([reviewSkill]);
    const reviewedPrompts: string[] = [];
    const registry = createAgentRegistry([
      stubAgent('claude', '完成'),
      {
        agentId: 'opencode',
        async runTurn(input) {
          reviewedPrompts.push(input.prompt);
          return { sessionId: 's', content: '审查意见:通过', status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    // 模拟写手改动:在 workdir 写入文件
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    const final = await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });
    expect(final.status).toBe('completed');

    const cards = await stores.approvals.list(thread.id);
    expect(cards.length).toBe(1);
    expect(cards[0]?.status).toBe('reviewing');
    expect(cards[0]?.reviewComment).toContain('通过');
    expect(reviewedPrompts[0]).toContain('x.txt');

    const messages = await stores.messages.list(thread.id);
    const cardMsg = messages.find((m) => m.role === 'system' && m.content.includes('审批卡片'));
    expect(cardMsg?.content).toContain('#approve');
    expect(cardMsg?.content).toContain('结论不算通过');
    expect(messages.some((m) => m.role === 'assistant' && m.agentId === 'opencode')).toBe(true);
    expect(messages.some((m) => m.role === 'system' && m.content.includes('🤝 审查:'))).toBe(true);
  });

  it('三只都在且无 A2A → 默认闪闪审,不拉团团', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let geminiCalls = 0;
    let opencodeCalls = 0;
    const registry = createAgentRegistry([
      stubAgent('claude', '写好了'),
      {
        agentId: 'gemini',
        async runTurn() {
          geminiCalls += 1;
          return { sessionId: 's-g', content: '## 结论\n通过', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          opencodeCalls += 1;
          return { sessionId: 's-o', content: '团团不该出场', status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });

    expect(geminiCalls).toBe(1);
    expect(opencodeCalls).toBe(0);
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.reviewerAgentId).toBe('gemini');
  });

  it('审查官跟配置 handoffTo,不写死闪闪', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let geminiCalls = 0;
    let opencodeCalls = 0;
    const registry = createAgentRegistry([
      stubAgent('claude', '写好了'),
      {
        agentId: 'gemini',
        async runTurn() {
          geminiCalls += 1;
          return { sessionId: 's-g', content: '闪闪不该出场', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          opencodeCalls += 1;
          return { sessionId: 's-o', content: '## 结论\n通过', status: 'completed' };
        },
      },
    ]);
    const agents = DEFAULT_AGENTS.map((a) =>
      a.id === 'claude' ? { ...cloneAgentSpec(a), handoffTo: 'opencode' as const } : cloneAgentSpec(a),
    );
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    await executeTurn({
      threadId: thread.id,
      content: '写个文件',
      context: { stores, registry, agents },
    });

    expect(opencodeCalls).toBe(1);
    expect(geminiCalls).toBe(0);
    expect((await stores.approvals.list(thread.id))[0]?.reviewerAgentId).toBe('opencode');
  });

  it('审查需修改 → 打回写手再审,通过后才出卡片', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let writerCalls = 0;
    let reviewRound = 0;
    const writerPrompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writerCalls += 1;
          writerPrompts.push(input.prompt);
          return { sessionId: 's-w', content: `写好了#${writerCalls}`, status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          reviewRound += 1;
          const content =
            reviewRound === 1
              ? '## 问题\n缺测试\n## 结论\n需修改'
              : '已实际运行 `node -e "console.log(1)"` 输出 1\n## 结论\n通过';
          return { sessionId: 's-r', content, status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });

    expect(writerCalls).toBe(3);
    expect(reviewRound).toBe(2);
    expect(writerPrompts[1]).toContain('出口补问');
    expect(writerPrompts[2]).toContain('需修改');
    expect(writerPrompts[2]).toContain('审查');

    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('🤝 打回:'))).toBe(true);
    const reviewers = messages.filter((m) => m.role === 'assistant' && m.agentId === 'opencode');
    expect(reviewers.length).toBe(2);
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.reviewComment).toContain('通过');
    expect(card?.status).toBe('reviewing');
    const cardMsg = messages.find((m) => m.content.includes('审批卡片'));
    expect(cardMsg?.content).toContain('#approve');
    expect(cardMsg?.content).toContain('通过');
  });

  it('autoApprove 遇需修改不落地,打回再审仍不通过则等人', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let writerCalls = 0;
    let reviewRound = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          writerCalls += 1;
          return { sessionId: 's-w', content: '写好了', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          reviewRound += 1;
          return { sessionId: 's-r', content: '## 结论\n需修改\n请修栈溢出', status: 'completed' };
        },
      },
    ]);
    await stores.profiles.create({
      agentId: 'claude', name: '墨墨', personality: 'x', role: '写手', expertise: [],
      autoApprove: true,
    });
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'auto.txt'), 'v1');

    await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });

    expect(writerCalls).toBe(2 + MAX_REVIEW_FIX_ROUNDS);
    expect(reviewRound).toBe(1 + MAX_REVIEW_FIX_ROUNDS);
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.status).toBe('reviewing');
    const cardMsg = (await stores.messages.list(thread.id)).find((m) => m.content.includes('审批卡片'));
    expect(cardMsg?.content).toContain('仍需修改');
    expect(cardMsg?.content).not.toContain('已自动批准');
  });

  it('无 diff 不创建卡片', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '纯聊天')]);
    const thread = await makeGitThread(stores);
    await executeTurn({ threadId: thread.id, content: '聊聊', context: { stores, registry } });
    expect((await stores.approvals.list(thread.id)).length).toBe(0);
  });

  it('写手 autoApprove → 审查后自动批准落地', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      stubAgent('claude', '完成'),
      {
        agentId: 'opencode',
        async runTurn() {
          return { sessionId: 's', content: '已实际运行 add(2,3),返回 5\n审查通过', status: 'completed' };
        },
      },
    ]);
    await stores.profiles.create({
      agentId: 'claude', name: '墨墨', personality: 'x', role: '写手', expertise: [],
      autoApprove: true,
    });
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'auto.txt'), 'v1');

    await executeTurn({ threadId: thread.id, content: '写个文件', context: { stores, registry } });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.status).toBe('applied');
    const messages = await stores.messages.list(thread.id);
    const cardMsg = messages.find((m) => m.content.includes('审批卡片'));
    expect(cardMsg?.content).toContain('已自动批准');
  });

  it('写了通过但没有验证证据,不算通过也不能自动落地', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      stubAgent('claude', '完成'),
      {
        agentId: 'opencode',
        async runTurn() {
          return { sessionId: 's', content: '## 结论\n通过', status: 'completed' };
        },
      },
    ]);
    await stores.profiles.create({
      agentId: 'claude', name: '墨墨', personality: 'x', role: '写手', expertise: [],
      autoApprove: true,
    });
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'bare.txt'), 'v1');

    await executeTurn({ threadId: thread.id, content: '写个文件', context: { stores, registry } });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.status).toBe('reviewing');
    const cardMsg = (await stores.messages.list(thread.id)).find((m) => m.content.includes('审批卡片'));
    expect(cardMsg?.content).toContain('结论不算通过');
    expect(cardMsg?.content).not.toContain('已自动批准');
  });

  it('未开 autoApprove → 仍等待人工批准', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      stubAgent('claude', '完成'),
      {
        agentId: 'opencode',
        async runTurn() {
          return { sessionId: 's', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'manual.txt'), 'v1');

    await executeTurn({ threadId: thread.id, content: '写个文件', context: { stores, registry } });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.status).toBe('reviewing');
  });

  it('有 pending 时本轮不跑自动审查', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let geminiCalls = 0;
    const registry = createAgentRegistry([
      stubAgent('claude', '写好了。\n@gemini 请审查这份代码\n重点看边界。'),
      {
        agentId: 'gemini',
        async runTurn() {
          geminiCalls += 1;
          return { sessionId: 's-g', content: '## 结论\n通过', status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });
    expect(geminiCalls).toBe(0);
    expect(await stores.approvals.list(thread.id)).toEqual([]);
    expect((await stores.messages.list(thread.id)).some((m) => m.content.includes('🤝 接力:'))).toBe(true);

    await executeTurn({
      threadId: thread.id, content: '继续', context: { stores, registry },
    });
    expect(geminiCalls).toBe(1);
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.reviewerAgentId).toBe('gemini');
    expect(card?.reviewComment).toContain('通过');
  });

  it('A2A 已审过则不再拉第三只猫', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let opencodeCalls = 0;
    const registry = createAgentRegistry([
      stubAgent('claude', '写好了。\n@gemini 请审查这份代码\n重点看边界。'),
      {
        agentId: 'gemini',
        async runTurn() {
          return { sessionId: 's-g', content: '## 结论\n通过', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          opencodeCalls += 1;
          return { sessionId: 's-o', content: '团团不该出场', status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });
    await executeTurn({
      threadId: thread.id, content: '继续', context: { stores, registry },
    });

    expect(opencodeCalls).toBe(0);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('🤝 接力:'))).toBe(true);
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.reviewerAgentId).toBe('gemini');
    expect(card?.reviewComment).toContain('通过');
  });

  it('A2A 审出需修改 → 打回写手并由同一审查官再审', async () => {
    const stores = createMemoryStores([reviewSkill]);
    let writerCalls = 0;
    let geminiCalls = 0;
    let opencodeCalls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          writerCalls += 1;
          return {
            sessionId: 's-w',
            content:
              writerCalls === 1
                ? '写好了。\n@gemini 请审查这份代码\n重点看边界。'
                : '已按审查改完',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          geminiCalls += 1;
          return {
            sessionId: 's-g',
            content: geminiCalls === 1 ? '## 结论\n需修改' : '## 结论\n通过',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          opencodeCalls += 1;
          return { sessionId: 's-o', content: '团团不该出场', status: 'completed' };
        },
      },
    ]);
    const thread = await makeGitThread(stores);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello');

    await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });
    expect(geminiCalls).toBe(0);
    await executeTurn({
      threadId: thread.id, content: '继续', context: { stores, registry },
    });

    expect(opencodeCalls).toBe(0);
    expect(writerCalls).toBe(2);
    expect(geminiCalls).toBe(2);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('🤝 打回:'))).toBe(true);
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.reviewerAgentId).toBe('gemini');
    expect(card?.reviewComment).toContain('通过');
  });

  it('#approve 批准卡片并落地', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', 'x')]);
    const thread = await makeGitThread(stores);
    // 造一个真实改动,让落地提交真正发生
    writeFileSync(join(thread.workdir, 'applied.txt'), 'v1');
    const card = await stores.approvals.create({
      threadId: thread.id, writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: 's',
    });
    const final = await executeTurn({
      threadId: thread.id, content: `#approve ${card.id}`, context: { stores, registry },
    });
    expect(final.role).toBe('system');
    expect(final.content).toContain('✅ 已批准并落地');
    expect((await stores.approvals.get(card.id))?.status).toBe('applied');
  });

  it('#reject 打回卡片带理由', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', 'x')]);
    const thread = await makeGitThread(stores);
    const card = await stores.approvals.create({
      threadId: thread.id, writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: 's',
    });
    const final = await executeTurn({
      threadId: thread.id, content: `#reject ${card.id} 边界没覆盖`, context: { stores, registry },
    });
    expect(final.content).toContain('⛔ 已打回');
    expect((await stores.approvals.get(card.id))?.status).toBe('rejected');
    expect((await stores.approvals.get(card.id))?.rejectReason).toBe('边界没覆盖');
  });
});

describe('executeTurn 多角色协作', () => {
  it('A2A 交棒后本轮不跑下一只,再触发才吃同一份包', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const opencodePrompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls.push('claude');
          return {
            sessionId: 's1',
            content: '代码写完了。\n@opencode 请审查这段代码\n注意边界条件。',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'opencode',
        async runTurn(input) {
          calls.push('opencode');
          opencodePrompts.push(input.prompt);
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const first = await executeTurn({
      threadId: thread.id, content: '@claude 写代码', context: { stores, registry },
    });
    expect(first.agentId).toBe('claude');
    expect(calls).toEqual(['claude']);
    expect((await stores.threads.get(thread.id))?.pendingHop?.to).toBe('opencode');
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('下一棒平台接着跑'))).toBe(true);

    const second = await executeTurn({
      threadId: thread.id, content: '继续', context: { stores, registry },
    });
    expect(second.agentId).toBe('opencode');
    expect(calls).toEqual(['claude', 'opencode']);
    expect(opencodePrompts[0]).toContain('【A2A 交接包】');
    expect(opencodePrompts[0]).toContain('代码写完了');
    expect(opencodePrompts[0]).toContain('请审查这段代码');
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
  });

  it('交棒后平台自己续跑,不必再发继续', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls.push('claude');
          return {
            sessionId: 's1',
            content: '写完了。\n@opencode 请审查',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          calls.push('opencode');
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const ctx = { stores, registry };
    await executeTurn({ threadId: thread.id, content: '@claude 写代码', context: ctx });
    expect(calls).toEqual(['claude']);
    await followPendingChain({ threadId: thread.id, context: ctx });
    expect(calls).toEqual(['claude', 'opencode']);
    const users = (await stores.messages.list(thread.id)).filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
  });

  it('多 @ 同题并行:每个目标收到同一消息', async () => {
    const stores = createMemoryStores();
    const prompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(`claude:${input.prompt}`);
          return { sessionId: 's1', content: '墨墨写好了', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn(input) {
          prompts.push(`opencode:${input.prompt}`);
          return { sessionId: 's2', content: '团团写好了', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id,
      content: '@claude\n@opencode\n写个加法函数 写个乘法函数',
      context: { stores, registry },
    });
    // 两个目标都收到清理后的同一消息(无 @ 标记)
    expect(prompts.length).toBe(2);
    for (const p of prompts) {
      expect(p).toContain('写个加法函数');
      expect(p).toContain('写个乘法函数');
      expect(p).not.toContain('@claude');
    }
    expect(final.agentId).toBe('claude');

    const messages = await stores.messages.list(thread.id);
    const assistants = messages.filter((m) => m.role === 'assistant');
    expect(assistants.map((m) => m.agentId).sort()).toEqual(['claude', 'opencode']);
  });

  it('A2A 接力:回复行首 @ 自动续跑,后角能看到前角输出', async () => {
    const stores = createMemoryStores();
    const opencodePrompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return {
            sessionId: 's1',
            content: '代码写完了。\n@opencode 请审查这段代码\n注意边界条件。',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'opencode',
        async runTurn(input) {
          opencodePrompts.push(input.prompt);
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '@claude 写代码', context: { stores, registry },
    });
    const final = await executeTurn({
      threadId: thread.id, content: '继续', context: { stores, registry },
    });
    expect(final.agentId).toBe('opencode');
    // 后角 prompt 包含前角输出
    expect(opencodePrompts[0]).toContain('【A2A 交接包】');
    expect(opencodePrompts[0]).toContain('用户目标:');
    expect(opencodePrompts[0]).toContain('代码写完了');
    expect(opencodePrompts[0]).toContain('【你的任务】');
    expect(opencodePrompts[0]).toContain('【收棒】');
    expect(opencodePrompts[0]).toContain('验证:');
    expect(opencodePrompts[0]).toContain('请审查这段代码');
    const messages = await stores.messages.list(thread.id);
    const assistants = messages.filter((m) => m.role === 'assistant');
    expect(assistants.map((m) => m.agentId)).toEqual(['claude', 'opencode']);
    const note = messages.find((m) => m.role === 'system' && m.content.includes('接力'));
    expect(note?.content).toContain('墨墨 → 团团');
    expect(note?.content).toContain('用户目标:');
    expect(note?.content).toContain('任务: 请审查这段代码');
  });

  it('每一跳都注入身份和团队纪律,不因已有 session 漏掉', async () => {
    const stores = createMemoryStores();
    const prompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.systemPrompt ?? '');
          return {
            sessionId: 's-claude',
            content: prompts.length === 1 ? '写完了\n@gemini 请审查' : '已按意见改',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'gemini',
        async runTurn(input) {
          prompts.push(input.systemPrompt ?? '');
          return { sessionId: 's-gemini', content: '## 结论\n需修改\n- 补测试', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '@claude 写代码',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    await executeTurn({
      threadId: thread.id,
      content: '继续',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    for (const prompt of prompts) {
      expect(prompt).toContain('团队纪律');
      expect(prompt).toMatch(/你是 (墨墨|闪闪)/);
    }
  });

  it('审查官写出结论后不再跟着 @ 写手往下交', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls.push('claude');
          return { sessionId: 's1', content: '写完了\n@gemini 请审查 add.ts', status: 'completed' };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          calls.push('gemini');
          return {
            sessionId: 's2',
            content: '## 结论\n通过\n@墨墨 要不要跟进由你安排',
            status: 'completed',
          };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '@claude 写 add.ts',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    await executeTurn({
      threadId: thread.id,
      content: '继续',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    expect(calls).toEqual(['claude', 'gemini']);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(false);
  });

  it('收了棒却没有结论也不交接,提示球还在地上', async () => {
    const stores = createMemoryStores();
    let geminiCalls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: 's1', content: '写完了\n@gemini 请审查', status: 'completed' };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          geminiCalls += 1;
          return { sessionId: 's2', content: '看了一下还行', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '@claude 写 add.ts',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    await executeTurn({
      threadId: thread.id,
      content: '继续',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    expect(geminiCalls).toBe(2);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('出口未明'))).toBe(true);
    const note = messages.find((m) => m.role === 'system' && m.content.includes('球还在地上'));
    expect(note?.content).toContain('闪闪');
  });

  it('行首等持球:不补问、不掉地上', async () => {
    const stores = createMemoryStores();
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-hold-'));
    let calls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls += 1;
          return { sessionId: 's1', content: '先停一下。\n等 测试跑完', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({
      title: 't',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);
    writeFileSync(join(thread.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    expect(calls).toBe(1);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('球在等'))).toBe(true);
    expect(messages.some((m) => m.content.includes('测试跑完'))).toBe(true);
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(false);
    expect(messages.some((m) => m.content.includes('出口未明'))).toBe(false);
    expect(messages.some((m) => m.content.includes('审批卡片'))).toBe(false);
  });

  it('行首等跑:平台跑完再叫醒同一只', async () => {
    const stores = createMemoryStores();
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-holdcmd-'));
    const prompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.prompt);
          return {
            sessionId: 's1',
            content: prompts.length === 1
              ? '先自检。\n等跑 node -e "process.stdout.write(\'hold-ok\')"'
              : '看到结果了。通过',
            status: 'completed',
          };
        },
      },
    ]);
    const thread = await stores.threads.create({
      title: 't',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);
    writeFileSync(join(thread.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    const ctx = { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: ctx,
    });
    expect(prompts).toHaveLength(1);
    const pending = (await stores.threads.get(thread.id))?.pendingHop;
    expect(pending?.holdCommand).toContain('hold-ok');
    expect(pending?.to).toBe('claude');
    const before = await stores.messages.list(thread.id);
    expect(before.some((m) => m.content.includes('球在等'))).toBe(true);
    expect(before.some((m) => m.content.includes('球还在地上'))).toBe(false);
    expect(before.some((m) => m.content.includes('出口未明'))).toBe(false);
    expect(before.some((m) => m.content.includes('审批卡片'))).toBe(false);
    await followPendingChain({ threadId: thread.id, context: ctx });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('命令跑完');
    expect(prompts[1]).toContain('hold-ok');
    const after = await stores.messages.list(thread.id);
    expect(after.some((m) => m.content.includes('跑完'))).toBe(true);
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    rmSync(workdirBase, { recursive: true, force: true });
  });

  it('人开口取消等跑,不再叫醒', async () => {
    const stores = createMemoryStores();
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-holdcmd-cancel-'));
    const prompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.prompt);
          return {
            sessionId: 's1',
            content: prompts.length === 1 ? '等跑 node -e "process.stdout.write(1)"' : '听你的',
            status: 'completed',
          };
        },
      },
    ]);
    const thread = await stores.threads.create({
      title: 't',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    const ctx = { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写一点',
      context: ctx,
    });
    expect((await stores.threads.get(thread.id))?.pendingHop?.holdCommand).toBeTruthy();
    await executeTurn({
      threadId: thread.id,
      content: '先停下',
      context: ctx,
    });
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    await followPendingChain({ threadId: thread.id, context: ctx });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe('先停下');
    rmSync(workdirBase, { recursive: true, force: true });
  });

  it('简单问答不提示球还在地上', async () => {
    const stores = createMemoryStores();
    let calls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls += 1;
          return { sessionId: 's1', content: '我是墨墨', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: '你是谁',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    expect(calls).toBe(1);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(false);
    expect(messages.some((m) => m.content.includes('出口未明'))).toBe(false);
  });

  it('有 diff 忘了交棒,补问一次后行首 @ 则交接', async () => {
    const stores = createMemoryStores();
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-nudge-'));
    const prompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.prompt);
          return {
            sessionId: 's1',
            content: prompts.length === 1 ? '写好了' : '补交。\n@gemini 请审查 add.ts',
            status: 'completed',
          };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          throw new Error('本轮不应跑闪闪');
        },
      },
    ]);
    const thread = await stores.threads.create({
      title: 't',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);
    writeFileSync(join(thread.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('出口补问');
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('出口未明'))).toBe(true);
    expect(messages.some((m) => m.content.includes('🤝 接力'))).toBe(true);
    expect((await stores.threads.get(thread.id))?.pendingHop?.to).toBe('gemini');
    rmSync(workdirBase, { recursive: true, force: true });
  });

  it('A2A 防环:已出场角色不再重复接力', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls.push('claude');
          return { sessionId: 's1', content: '@opencode 你来', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          calls.push('opencode');
          return { sessionId: 's2', content: '@claude 你再看看', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    await executeTurn({ threadId: thread.id, content: '继续', context: { stores, registry } });
    // claude → 待跑 opencode → 续跑后想交回 claude,已出场则停
    expect(calls).toEqual(['claude', 'opencode']);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(true);
    expect(messages.some((m) => m.content.includes('想交给墨墨'))).toBe(true);
  });

  it('A2A 中文名接力:@团团 与 @opencode 等价', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls.push('claude');
          return { sessionId: 's1', content: '@团团 请接着做', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          calls.push('opencode');
          return { sessionId: 's2', content: '做好了。通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '@墨墨 开工', context: { stores, registry },
    });
    await executeTurn({
      threadId: thread.id, content: '继续', context: { stores, registry },
    });
    expect(calls).toEqual(['claude', 'opencode']);
  });

  it('A2A 句中 @ 不交接,留下提示', async () => {
    const stores = createMemoryStores();
    let claudeCalls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          claudeCalls += 1;
          return { sessionId: 's1', content: '写完了,请 @团团 审查。', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          throw new Error('不应被叫到');
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    expect(claudeCalls).toBe(2);
    const messages = await stores.messages.list(thread.id);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(2);
    expect(messages.some((m) => m.content.includes('出口未明'))).toBe(true);
    const hint = messages.find((m) => m.role === 'system' && m.content.includes('句中'));
    expect(hint?.content).toContain('@团团');
  });

  it('A2A 行首 @人 停链,球回人手里,不叫下一只猫', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: 's1', content: '方向定不了。\n@人 这个方案做不做', status: 'completed' };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          throw new Error('不应被叫到');
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id,
      content: '@claude 写代码',
      context: { stores, registry },
    });
    expect(final.agentId).toBe('claude');
    const messages = await stores.messages.list(thread.id);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    const note = messages.find((m) => m.role === 'system' && m.content.includes('球在人手里'));
    expect(note?.content).toContain('墨墨请求拍板');
    expect(note?.content).toContain('这个方案做不做');
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(false);
  });

  it('审查官行首 @人 也升级,不按审查收棒吞掉', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'gemini',
        async runTurn() {
          return { sessionId: 's1', content: '有产品取舍。\n@owner 先做快的还是稳的', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'gemini' });
    await executeTurn({
      threadId: thread.id,
      content: '@gemini 审一下',
      context: { stores, registry, agents: DEFAULT_AGENTS.map(cloneAgentSpec) },
    });
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('闪闪请求拍板'))).toBe(true);
    expect(messages.some((m) => m.content.includes('球还在地上'))).toBe(false);
  });

  it('A2A 链深可配置:maxDepth=1 不接力', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          calls.push('claude');
          return { sessionId: 's1', content: '@opencode 你来', status: 'completed' };
        },
      },
      {
        agentId: 'opencode',
        async runTurn() {
          calls.push('opencode');
          return { sessionId: 's2', content: '好', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: { stores, registry, a2aMaxDepth: 1 },
    });
    expect(calls).toEqual(['claude']);
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.content.includes('接力链已达上限'))).toBe(true);
  });

  it('systemPrompt 用 config.agents 身份覆盖 Redis profile', async () => {
    const stores = createMemoryStores();
    await stores.profiles.create({
      agentId: 'claude',
      name: '墨墨',
      personality: '旧性格',
      role: '写手',
      expertise: ['TS'],
    });
    let captured: string | undefined;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          captured = input.systemPrompt;
          return { sessionId: 's', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id,
      content: 'hi',
      context: {
        stores,
        registry,
        agents: [
          {
            id: 'claude',
            name: '墨墨改',
            aliases: ['墨墨改', 'claude'],
            role: '新角色',
            personality: '新性格',
            expertise: ['Rust'],
            bin: 'claude',
          },
        ],
      },
    });
    expect(captured).toContain('墨墨改');
    expect(captured).toContain('新角色');
    expect(captured).toContain('新性格');
    expect(captured).toContain('Rust');
  });
});
