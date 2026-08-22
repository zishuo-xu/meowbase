import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn } from '../src/router/execute-turn.js';
import { gitAddAll, gitInit, gitWorktreeAdd } from '../src/services/git.js';
import { DEFAULT_AGENTS } from '../src/config.js';
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

  it('基准分支远端引用变了出越界句', async () => {
    const { repo, stores, thread } = await bindThread();
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-gst-base-'));
    cleanups.push(bare);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    await exec('git', ['remote', 'add', 'origin', bare], { cwd: repo });
    await exec('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });

    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          const fake = (
            await exec('git', ['commit-tree', 'HEAD^{tree}', '-m', 'moved-base'], { cwd: input.workdir })
          ).stdout.trim();
          await exec('git', ['update-ref', 'refs/remotes/origin/main', fake], { cwd: input.workdir });
          return { sessionId: 's-w', content: '没改文件', status: 'completed' };
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
    expect(moves.some((m) => m.content.includes('⚠️') && m.content.includes('基准分支'))).toBe(true);
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
