import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn, followPendingChain } from '../src/router/execute-turn.js';
import { gitAddAll, gitInit, gitWorktreeAdd } from '../src/services/git.js';
import { DEFAULT_AGENTS } from '../src/config.js';
import { auditApprovals, auditMessages } from '../src/stores/audit-log.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';

const exec = promisify(execFile);

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

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function commitAsCat(dir: string, message: string): Promise<void> {
  await exec(
    'git',
    [
      '-c',
      'user.name=tester',
      '-c',
      'user.email=t@t.local',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      message,
    ],
    { cwd: dir },
  );
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
  const repo = mkdtempSync(join(tmpdir(), 'meowbase-gst-repo-'));
  const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-gst-work-'));
  cleanups.push(repo, workdirBase);
  await initScratchRepo(repo);
  const stores = createMemoryStores();
  const thread = await stores.threads.create({
    title: 'git-state',
    primaryAgentId: 'claude',
    workdirBase,
    repo: { path: repo, baseBranch: 'main' },
  });
  await gitWorktreeAdd(repo, thread.workdir, thread.repo!.branch, 'main');
  return { repo, stores, thread };
}

describe('绑仓线程 git 状态追踪', () => {
  it('猫自己提交之后审批卡仍然建得出来', async () => {
    const { stores, thread } = await bindThread();
    let committed = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          if (!committed) {
            writeFileSync(join(input.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
            await exec('git', ['add', 'add.ts'], { cwd: input.workdir });
            await commitAsCat(input.workdir, 'cat commit');
            committed = true;
          }
          return { sessionId: 's-w', content: '写好了并提交了', status: 'completed' };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 加个函数',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    const cards = await stores.approvals.list(thread.id);
    expect(cards.length).toBe(1);
    expect(cards[0]?.diffText).toContain('add.ts');
    expect(cards[0]?.diffText).toContain('+export const add');
  });

  it('猫自己提交后时间线出 git-move 提交句', async () => {
    const { stores, thread } = await bindThread();
    let committed = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          if (!committed) {
            writeFileSync(join(input.workdir, 'note.txt'), 'x\n');
            await exec('git', ['add', 'note.txt'], { cwd: input.workdir });
            await commitAsCat(input.workdir, 'cat commit');
            committed = true;
          }
          return { sessionId: 's-w', content: '提交了', status: 'completed' };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 记一笔',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    const moves = (await stores.messages.list(thread.id)).filter(
      (m) => m.role === 'system' && m.systemKind === 'git-move',
    );
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.content.includes('提交了') && m.content.includes('commit'))).toBe(true);
    expect(moves.some((m) => m.content.includes(thread.repo!.branch))).toBe(true);
  });

  it('手动推分支后出推到了 origin', async () => {
    const { repo, stores, thread } = await bindThread();
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-gst-bare-'));
    cleanups.push(bare);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    await exec('git', ['remote', 'add', 'origin', bare], { cwd: repo });
    await exec('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });

    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          await exec('git', ['push', '-q', '-u', 'origin', thread.repo!.branch], { cwd: input.workdir });
          return { sessionId: 's-w', content: '推了', status: 'completed' };
        },
      },
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    const moves = (await stores.messages.list(thread.id)).filter(
      (m) => m.role === 'system' && m.systemKind === 'git-move',
    );
    expect(moves.some((m) => m.content.includes('推到了 origin'))).toBe(true);
  });

  it('推自己那根只落 git-move,接力继续', async () => {
    const { repo, stores, thread } = await bindThread();
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-gst-own-'));
    cleanups.push(bare);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    await exec('git', ['remote', 'add', 'origin', bare], { cwd: repo });
    await exec('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });

    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'own.txt'), 'ok\n');
          await exec('git', ['add', 'own.txt'], { cwd: input.workdir });
          await commitAsCat(input.workdir, 'own commit');
          await exec('git', ['push', '-q', '-u', 'origin', thread.repo!.branch], { cwd: input.workdir });
          return {
            sessionId: 's-w',
            content: '推了自己这根。\n@闪闪 请审查 own.txt',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = { stores, registry, agents: DEFAULT_AGENTS };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 推自己这根',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'git-overstep')).toBe(false);
    expect(
      rows.some(
        (m) =>
          m.role === 'system' &&
          m.systemKind === 'git-move' &&
          m.content.includes('推到了 origin'),
      ),
    ).toBe(true);
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(true);
    expect((await stores.approvals.list(thread.id)).length).toBe(1);
  });

  it('推基准分支:停接力、不建卡、球给人、审计带 sha', async () => {
    const { repo, stores: raw, thread } = await bindThread();
    const stores = {
      ...raw,
      messages: auditMessages(raw.messages, raw.audit),
      approvals: auditApprovals(raw.approvals, raw.audit),
    };
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-gst-over-'));
    cleanups.push(bare);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    await exec('git', ['remote', 'add', 'origin', bare], { cwd: repo });
    await exec('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });
    const beforeSha = (
      await exec('git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: repo })
    ).stdout.trim();

    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'overstep.txt'), 'x\n');
          const fake = (
            await exec('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'moved-base'], {
              cwd: input.workdir,
            })
          ).stdout.trim();
          await exec('git', ['push', '-q', 'origin', `${fake}:refs/heads/main`], { cwd: input.workdir });
          return {
            sessionId: 's-w',
            content: '推了基准分支。\n@闪闪 请审查 overstep.txt',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = { stores, registry, agents: DEFAULT_AGENTS };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    const over = rows.filter((m) => m.role === 'system' && m.systemKind === 'git-overstep');
    expect(over.length).toBe(1);
    expect(over[0]?.content).toContain('⚠️');
    expect(over[0]?.content).toContain('基准分支');
    expect(over[0]?.systemMeta?.baseBranch).toBe('main');
    expect(over[0]?.systemMeta?.beforeSha).toBe(beforeSha);
    expect(over[0]?.systemMeta?.afterSha).toMatch(/^[0-9a-f]{40}$/);
    expect(over[0]?.systemMeta?.afterSha).not.toBe(beforeSha);
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(false);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'relay')).toBe(false);
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    expect(await stores.approvals.list(thread.id)).toEqual([]);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'git-move')).toBe(false);

    const audit = (await raw.audit.list({ threadId: thread.id })).filter(
      (r) => r.action === 'git-overstep',
    );
    expect(audit.length).toBe(1);
    expect(audit[0]?.meta?.baseBranch).toBe('main');
    expect(audit[0]?.meta?.beforeSha).toBe(beforeSha);
    expect(audit[0]?.meta?.afterSha).toBe(over[0]?.systemMeta?.afterSha);
  });

  it('本地基准分支 ref 动了也越界停接力', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, 'local.txt'), 'x\n');
          const fake = (
            await exec('git', ['commit-tree', 'HEAD^{tree}', '-m', 'force-main'], { cwd: input.workdir })
          ).stdout.trim();
          await exec('git', ['update-ref', 'refs/heads/main', fake], { cwd: input.workdir });
          return {
            sessionId: 's-w',
            content: '动了本地 main。\n@闪闪 请审查 local.txt',
            status: 'completed',
          };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);
    const ctx = { stores, registry, agents: DEFAULT_AGENTS };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: ctx,
    });
    await followPendingChain({ threadId: thread.id, context: ctx });

    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.role === 'system' && m.systemKind === 'git-overstep')).toBe(true);
    expect(rows.some((m) => m.content.includes('本地引用'))).toBe(true);
    expect(rows.some((m) => m.role === 'assistant' && m.agentId === 'gemini')).toBe(false);
    expect(await stores.approvals.list(thread.id)).toEqual([]);
  });

  it('空沙箱线程一句 git-move 都不出', async () => {
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-gst-sandbox-'));
    cleanups.push(workdirBase);
    const stores = createMemoryStores();
    const thread = await stores.threads.create({
      title: 'sandbox',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);

    let committed = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          if (!committed) {
            writeFileSync(join(input.workdir, 'a.txt'), 'x\n');
            await exec('git', ['add', 'a.txt'], { cwd: input.workdir });
            await commitAsCat(input.workdir, 'cat commit');
            committed = true;
          }
          return { sessionId: 's-w', content: '提交了', status: 'completed' };
        },
      },
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 记一笔',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    const moves = (await stores.messages.list(thread.id)).filter(
      (m) => m.role === 'system' && m.systemKind === 'git-move',
    );
    expect(moves).toEqual([]);
  });

  it('猫自己提交之后 #approve 落 approval-applied,不是 approval-failed', async () => {
    const { stores, thread } = await bindThread();
    let committed = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          if (!committed) {
            writeFileSync(join(input.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
            await exec('git', ['add', 'add.ts'], { cwd: input.workdir });
            await commitAsCat(input.workdir, 'cat commit');
            committed = true;
          }
          return { sessionId: 's-w', content: '写好了并提交了', status: 'completed' };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 加个函数',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card).toBeTruthy();

    const final = await executeTurn({
      threadId: thread.id,
      content: `#approve ${card!.id}`,
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    expect(final.systemKind).toBe('approval-applied');
    expect(final.content).toContain('已批准并落地');
    expect((await stores.approvals.get(card!.id))?.status).toBe('applied');
  });

  it('建卡后清掉暂存区再 #approve 不假装落地', async () => {
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-gst-approve-'));
    cleanups.push(workdirBase);
    const stores = createMemoryStores();
    const thread = await stores.threads.create({
      title: 't',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);

    const registry = createAgentRegistry([
      stub('claude', '写好了'),
      stub('gemini', '审查意见:通过'),
    ]);
    writeFileSync(join(thread.workdir, 'x.txt'), 'hello\n');
    await executeTurn({
      threadId: thread.id,
      content: '写个文件',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card).toBeTruthy();

    await exec('git', ['reset', '-q', 'HEAD'], { cwd: thread.workdir });
    const final = await executeTurn({
      threadId: thread.id,
      content: `#approve ${card!.id}`,
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    expect((await stores.approvals.get(card!.id))?.status).toBe('approved');
    expect(final.content).not.toContain('已落地');
    expect(final.content).toContain('批准记下了');
    expect(final.systemKind).toBe('approval-failed');
  });

  it('批准成功后 lastApprovedSha 前进,下一张卡不再含已批改动', async () => {
    const { stores, thread } = await bindThread();
    let file = 'first.ts';
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(join(input.workdir, file), `export const n = ${file};\n`);
          return { sessionId: `s-${file}`, content: `写了 ${file}`, status: 'completed' };
        },
      },
      stub('gemini', '审查意见:通过'),
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写第一个',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    const first = (await stores.approvals.list(thread.id))[0];
    expect(first?.diffText).toContain('first.ts');
    await gitAddAll(thread.workdir);
    await executeTurn({
      threadId: thread.id,
      content: `#approve ${first!.id}`,
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    expect((await stores.approvals.get(first!.id))?.status).toBe('applied');
    expect((await stores.threads.get(thread.id))?.repo?.lastApprovedSha).toMatch(/^[0-9a-f]{40}$/);

    file = 'second.ts';
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写第二个',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    const cards = await stores.approvals.list(thread.id);
    expect(cards.length).toBe(2);
    const second = cards.find((c) => c.id !== first!.id);
    expect(second?.diffText).toContain('second.ts');
    expect(second?.diffText).not.toContain('first.ts');
  });
});
