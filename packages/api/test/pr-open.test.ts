import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn, followPendingChain } from '../src/router/execute-turn.js';
import { gitInit, gitWorktreeAdd } from '../src/services/git.js';
import { DEFAULT_AGENTS } from '../src/config.js';
import { auditApprovals, auditMessages } from '../src/stores/audit-log.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';
import type { PrLookup, PrSnapshot } from '../src/services/pr.js';

const exec = promisify(execFile);

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function initScratchRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'scratch', private: true, type: 'module' }, null, 2),
  );
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

function stub(agentId: AgentId, reply: string): AgentService {
  return {
    agentId,
    async runTurn() {
      return { sessionId: `s-${agentId}`, content: reply, status: 'completed' };
    },
  };
}

async function bindThread() {
  const repo = mkdtempSync(join(tmpdir(), 'meowbase-pr-open-repo-'));
  const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-pr-open-work-'));
  cleanups.push(repo, workdirBase);
  await initScratchRepo(repo);
  const raw = createMemoryStores();
  const stores = {
    ...raw,
    messages: auditMessages(raw.messages, raw.audit),
    approvals: auditApprovals(raw.approvals, raw.audit),
  };
  const thread = await stores.threads.create({
    title: 'pr-open',
    primaryAgentId: 'claude',
    workdirBase,
    repo: { path: repo, baseBranch: 'main' },
  });
  await gitWorktreeAdd(repo, thread.workdir, thread.repo!.branch, 'main');
  return { repo, stores, thread, audit: raw.audit };
}

const openPr: PrSnapshot = {
  number: 12,
  state: 'OPEN',
  url: 'https://github.com/example/repo/pull/12',
  headRefOid: 'b'.repeat(40),
};

const mergedPr: PrSnapshot = {
  number: 12,
  state: 'MERGED',
  url: 'https://github.com/example/repo/pull/12',
  headRefOid: 'c'.repeat(40),
};

function lookupOf(pr: PrSnapshot | null): PrLookup {
  return async () => ({ ok: true, pr });
}

describe('绑仓线程开 PR / 合了就停', () => {
  it('第一次看见 OPEN:落 pr-opened 带链接,接力照跑', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'pr.txt'), 'opened\n');
          return {
            sessionId: 's-w',
            content: '开了 PR。\n@闪闪 请审查 pr.txt',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 开个 PR',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    const opened = rows.filter((m) => m.role === 'system' && m.systemKind === 'pr-opened');
    expect(opened.length).toBe(1);
    expect(opened[0]?.content).toContain('#12');
    expect(opened[0]?.content).toContain(openPr.url);
    expect(opened[0]?.systemMeta?.prNumber).toBe(12);
    expect(opened[0]?.systemMeta?.headRefOid).toBe(openPr.headRefOid);
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(true);
    expect((await stores.approvals.list(thread.id)).length).toBe(1);
    expect(rows.some((m) => m.content.includes('没有 PR'))).toBe(false);
  });

  it('PR 被合了:停接力、不建卡、球给人、审计带 number 和 sha', async () => {
    const { stores, thread, audit } = await bindThread();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'merged.txt'), 'x\n');
          return {
            sessionId: 's-w',
            content: '合了。\n@闪闪 请审查 merged.txt',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(mergedPr),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 把 PR 合了',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    const merged = rows.filter((m) => m.role === 'system' && m.systemKind === 'pr-merged');
    expect(merged.length).toBe(1);
    expect(merged[0]?.content).toContain('#12');
    expect(merged[0]?.content).toContain('已被合并');
    expect(merged[0]?.systemMeta?.prNumber).toBe(12);
    expect(merged[0]?.systemMeta?.headRefOid).toBe(mergedPr.headRefOid);
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(false);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'relay')).toBe(false);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'git-overstep')).toBe(false);
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    expect(await stores.approvals.list(thread.id)).toEqual([]);

    const auditRows = (await audit.list({ threadId: thread.id })).filter((r) => r.action === 'pr-merged');
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.meta?.prNumber).toBe(12);
    expect(auditRows[0]?.meta?.headRefOid).toBe(mergedPr.headRefOid);
  });

  it('查不到 PR 状态不停接力,也不说没有 PR', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'miss.txt'), 'x\n');
          return {
            sessionId: 's-w',
            content: '写好了。\n@闪闪 请审查 miss.txt',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: (async () => ({ ok: false, reason: 'gh 没装' })) satisfies PrLookup,
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    const notes = rows.filter((m) => m.role === 'system' && m.content.includes('查不到 PR 状态'));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]?.systemKind).toBe('notice');
    expect(notes[0]?.content).toBe('查不到 PR 状态(gh 没装)');
    expect(rows.some((m) => m.content.includes('没有 PR'))).toBe(false);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'pr-opened')).toBe(false);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'pr-merged')).toBe(false);
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(true);
    expect((await stores.approvals.list(thread.id)).length).toBe(1);
  });

  it('空沙箱线程不查 PR', async () => {
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-pr-sandbox-'));
    cleanups.push(workdirBase);
    const stores = createMemoryStores();
    const thread = await stores.threads.create({
      title: 'sandbox',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);

    let lookedUp = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: 's-w', content: '好', status: 'completed' };
        },
      },
    ]);
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 说一句',
      context: {
        stores,
        registry,
        agents: DEFAULT_AGENTS,
        lookupPr: async () => {
          lookedUp = true;
          return { ok: true, pr: null };
        },
      },
    });

    expect(lookedUp).toBe(false);
    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.content.includes('查不到 PR'))).toBe(false);
    expect(rows.some((m) => m.systemKind === 'pr-opened' || m.systemKind === 'pr-merged')).toBe(false);
  });

  it('不读猫正文里的 PR 链接', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return {
            sessionId: 's-w',
            content: '我开了 https://github.com/liar/repo/pull/99\n@闪闪 请审查',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(null),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 开个 PR',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.systemKind === 'pr-opened')).toBe(false);
    expect(rows.some((m) => m.content.includes('#99'))).toBe(false);
  });
});
