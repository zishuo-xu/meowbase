import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import type { AppStores } from '../src/stores/ports.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn } from '../src/router/execute-turn.js';
import { gitWorktreeAdd } from '../src/services/git.js';
import { DEFAULT_AGENTS } from '../src/config.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';
import {
  createFixedPrReviewList,
  type PrLookup,
  type PrReviewList,
  type PrSnapshot,
} from '../src/services/pr.js';

const exec = promisify(execFile);

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 够长、没文件也会照传,避免虚空门禁误拦测交棒的用例 */
const KEPT_HANDOFF_BODY =
  '方案已经写在上面:先落地加法函数并导出,再补零、负数和小数的边界测试,最后接到现有入口,不要顺手改无关文件,也不要另开一条。';

const openPr42: PrSnapshot = {
  number: 42,
  state: 'OPEN',
  url: 'https://github.com/example/repo/pull/42',
  headRefOid: 'b'.repeat(40),
};

function lookupOf(pr: PrSnapshot | null): PrLookup {
  return async () => ({ ok: true, pr });
}

async function bindThread(opts?: { allowRemote?: boolean; freshGet?: boolean }) {
  const repo = mkdtempSync(join(tmpdir(), 'meowbase-pr-review-repo-'));
  const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-pr-review-work-'));
  cleanups.push(repo, workdirBase);
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: repo });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  await exec('git', ['add', '-A'], { cwd: repo });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  const raw = createMemoryStores();
  // 模拟 redis 语义:get 每次返回新对象,
  // turn 开始时的 thread 快照不会跟着 setSeenPrCommentIds 更新
  const freshGetThreads = new Proxy(raw.threads, {
    get(target, prop) {
      if (prop === 'get') {
        return async (id: string) => structuredClone(await raw.threads.get(id));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const stores: AppStores = opts?.freshGet ? { ...raw, threads: freshGetThreads } : raw;
  const thread = await stores.threads.create({
    title: 'pr-review-flow',
    primaryAgentId: 'claude',
    workdirBase,
    repo: {
      path: repo,
      baseBranch: 'main',
      ...(opts?.allowRemote !== false ? { allowRemote: true } : {}),
    },
  });
  await gitWorktreeAdd(repo, thread.workdir, thread.repo!.branch, 'main');
  return { repo, stores, thread };
}

function stub(agentId: AgentId, reply: string): AgentService {
  return {
    agentId,
    async runTurn() {
      return { sessionId: `s-${agentId}`, content: reply, status: 'completed' };
    },
  };
}

/** 写手:改文件(有 diff)但不交棒,链停 */
function writerNoHandoff(): AgentService {
  return {
    agentId: 'claude',
    async runTurn(input) {
      writeFileSync(join(input.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
      return {
        sessionId: 's-w',
        content: '写好了 add.ts,加法函数已落地,实现细节都在文件里。',
        status: 'completed',
      };
    },
  };
}

describe('PR 评论回流:检测 + 叫醒', () => {
  it('人写的评论叫醒写手猫:落 pr-review 消息、pendingHop 指回写手、指纹推进、本轮不建卡', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([writerNoHandoff(), stub('gemini', '审查意见:通过')]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr42),
      listPrReviews: createFixedPrReviewList('user'),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: ctx,
    });

    const rows = await stores.messages.list(thread.id);
    const notes = rows.filter((m) => m.role === 'system' && m.systemKind === 'pr-review');
    expect(notes.length).toBe(1);
    expect(notes[0]?.content).toContain('reviewer-hr');
    expect(notes[0]?.content).toContain('#42');
    expect(notes[0]?.systemMeta?.prNumber).toBe(42);

    const after = await stores.threads.get(thread.id);
    const pending = after?.pendingHop;
    expect(pending?.to).toBe('claude');
    expect(pending?.task).toContain('除零要炸');
    expect(pending?.task).toContain('PR #42');
    expect(after?.repo?.seenPrCommentIds).toContain('c9001');

    // 叫醒和建卡同一轮只能出一个:卡上冻结的不能是处理评论之前的旧 diff
    expect(await stores.approvals.list(thread.id)).toEqual([]);
  });

  it('bot 评论只落消息不叫醒', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      stub('claude', '好,知道了。'),
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr42),
      listPrReviews: createFixedPrReviewList('bot'),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: ctx,
    });

    const rows = await stores.messages.list(thread.id);
    const notes = rows.filter((m) => m.role === 'system' && m.systemKind === 'pr-review');
    expect(notes.length).toBe(1);
    expect(notes[0]?.content).toContain('codecov-bot');
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    expect((await stores.threads.get(thread.id))?.repo?.seenPrCommentIds).toContain('c9001');
  });

  it('指纹去重:同一评论第二轮不再落消息、不再叫醒', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([writerNoHandoff(), stub('gemini', '审查意见:通过')]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr42),
      listPrReviews: createFixedPrReviewList('user'),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: ctx,
    });
    expect(
      (await stores.messages.list(thread.id)).filter((m) => m.systemKind === 'pr-review').length,
    ).toBe(1);
    expect((await stores.threads.get(thread.id))?.pendingHop?.to).toBe('claude');

    // 人开口续跑叫醒的那一跳;同一评论不该再落第二条
    await executeTurn({
      threadId: thread.id,
      content: '继续处理',
      context: ctx,
    });
    const rows = await stores.messages.list(thread.id);
    expect(rows.filter((m) => m.systemKind === 'pr-review').length).toBe(1);
    expect((await stores.threads.get(thread.id))?.repo?.seenPrCommentIds).toEqual(['c9001']);
  });

  it('本地模式零调用:listPrReviews 一次都不跑', async () => {
    const { stores, thread } = await bindThread({ allowRemote: false });
    const registry = createAgentRegistry([writerNoHandoff(), stub('gemini', '审查意见:通过')]);
    const throwingList: PrReviewList = async () => {
      throw new Error('本地模式不该查评论');
    };
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: (async () => {
        throw new Error('本地模式不该查 PR');
      }) satisfies PrLookup,
      listPrReviews: throwingList,
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: ctx,
    });

    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.systemKind === 'pr-review')).toBe(false);
    expect(rows.some((m) => m.content.includes('查不到 PR'))).toBe(false);
    expect((await stores.threads.get(thread.id))?.repo?.seenPrCommentIds).toBeUndefined();
  });

  it('多跳去重:同一 turn 两段都触发检测,同一评论只投一次(指纹读现值)', async () => {
    // freshGet 模拟 redis 的 get 语义:turn 开始时的 thread 快照是死对象,
    // 第一段推进的指纹第二段从快照上读不到——修复前会重投
    const { stores, thread } = await bindThread({ freshGet: true });
    const writer = (agentId: AgentId, file: string): AgentService => ({
      agentId,
      async runTurn(input) {
        writeFileSync(join(input.workdir, file), 'export const x = 1;\n');
        return {
          sessionId: `s-${agentId}`,
          content: `写好了 ${file},实现细节都在文件里。`,
          status: 'completed',
        };
      },
    });
    const registry = createAgentRegistry([writer('claude', 'add.ts'), writer('opencode', 'mul.ts')]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr42),
      listPrReviews: createFixedPrReviewList('user'),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@claude\n@opencode\n各写各的',
      context: ctx,
    });

    const rows = await stores.messages.list(thread.id);
    expect(rows.filter((m) => m.systemKind === 'pr-review').length).toBe(1);
    expect((await stores.threads.get(thread.id))?.repo?.seenPrCommentIds).toEqual(['c9001']);
  });

  it('纯持球不叫醒:落 pr-review 消息但 pendingHop 为空', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      stub('claude', '先停一下。\n等 测试跑完'),
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr42),
      listPrReviews: createFixedPrReviewList('user'),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: ctx,
    });

    const rows = await stores.messages.list(thread.id);
    expect(rows.filter((m) => m.systemKind === 'pr-review').length).toBe(1);
    expect(rows.some((m) => m.content.includes('球在等'))).toBe(true);
    // 纯持球是「人开口即取消」,平台不能用叫醒自动取消它
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
  });

  it('交接中的棒不许覆盖:stub 交棒时本轮只落 pr-review 消息,pendingHop 仍是交接那一棒', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
          return {
            sessionId: 's-w',
            content: `${KEPT_HANDOFF_BODY}\n写完了。\n@gemini 请审查 add.ts`,
            status: 'completed',
          };
        },
      },
      stub('gemini', '本轮不该被叫到'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr42),
      listPrReviews: createFixedPrReviewList('user'),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写 add.ts',
      context: ctx,
    });

    const rows = await stores.messages.list(thread.id);
    const notes = rows.filter((m) => m.role === 'system' && m.systemKind === 'pr-review');
    expect(notes.length).toBe(1);
    expect(notes[0]?.content).toContain('reviewer-hr');

    const after = await stores.threads.get(thread.id);
    expect(after?.pendingHop?.to).toBe('gemini');
    expect(after?.pendingHop?.task).toContain('请审查');
    expect(after?.repo?.seenPrCommentIds).toContain('c9001');
    // 审查那一棒还没跑
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(false);
  });
});
