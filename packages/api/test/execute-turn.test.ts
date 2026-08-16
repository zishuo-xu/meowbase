import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';
import { executeTurn } from '../src/router/execute-turn.js';
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

  it('新会话注入 profile;resume 仍注入交接规则', async () => {
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
    expect(prompts[0]).toContain('交接规则');
    // 第二轮:已有 session,不再注入身份,但仍注入团队交接规则
    await executeTurn({ threadId: thread.id, content: 'hi again', context: { stores, registry } });
    expect(prompts[1]).not.toContain('你是 墨墨');
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
          return { sessionId: 's', content: '审查通过', status: 'completed' };
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
      content: '@claude 写个加法函数 @opencode 写个乘法函数',
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
    const final = await executeTurn({
      threadId: thread.id, content: '@claude 写代码', context: { stores, registry },
    });
    expect(final.agentId).toBe('opencode');
    // 后角 prompt 包含前角输出
    expect(opencodePrompts[0]).toContain('【A2A 交接】');
    expect(opencodePrompts[0]).toContain('代码写完了');
    expect(opencodePrompts[0]).toContain('【你的任务】');
    expect(opencodePrompts[0]).toContain('请审查这段代码');
    const messages = await stores.messages.list(thread.id);
    const assistants = messages.filter((m) => m.role === 'assistant');
    expect(assistants.map((m) => m.agentId)).toEqual(['claude', 'opencode']);
    const note = messages.find((m) => m.role === 'system' && m.content.includes('接力'));
    expect(note?.content).toContain('墨墨 → 团团');
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
    // claude → opencode → (claude 已出场,停止)
    expect(calls).toEqual(['claude', 'opencode']);
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
          return { sessionId: 's2', content: '好', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '@墨墨 开工', context: { stores, registry },
    });
    expect(calls).toEqual(['claude', 'opencode']);
  });

  it('A2A 句中 @ 不交接,留下提示', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
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
    const messages = await stores.messages.list(thread.id);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    const hint = messages.find((m) => m.role === 'system' && m.content.includes('句中'));
    expect(hint?.content).toContain('@团团');
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
