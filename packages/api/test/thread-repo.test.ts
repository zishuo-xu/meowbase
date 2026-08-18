import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn } from '../src/router/execute-turn.js';
import { gitWorktreeAdd } from '../src/services/git.js';
import { DEFAULT_AGENTS } from '../src/config.js';

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

describe('绑真实仓库的线程', () => {
  it('审批卡 diff 只含 worktree 改动;#approve 只提交到 meow/<id>', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-bound-repo-'));
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-bound-work-'));
    cleanups.push(repo, workdirBase);
    await initScratchRepo(repo);
    writeFileSync(join(repo, 'only-main.txt'), 'main only\n');

    const stores = createMemoryStores();
    const thread = await stores.threads.create({
      title: '绑仓验收',
      primaryAgentId: 'claude',
      workdirBase,
      repo: { path: repo, baseBranch: 'main' },
    });
    await gitWorktreeAdd(repo, thread.workdir, thread.repo!.branch, 'main');

    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          writeFileSync(
            join(input.workdir, 'add.ts'),
            'export function add(a: number, b: number) { return a + b; }\n',
          );
          return { sessionId: 's-w', content: '写好了 add.ts', status: 'completed' };
        },
      },
      {
        agentId: 'gemini',
        async runTurn() {
          return { sessionId: 's-r', content: '审查意见:通过', status: 'completed' };
        },
      },
    ]);

    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 加个函数',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    const cards = await stores.approvals.list(thread.id);
    expect(cards.length).toBe(1);
    expect(cards[0]?.diffText).toContain('add.ts');
    expect(cards[0]?.diffText).toContain('+export function add');
    expect(cards[0]?.diffText).not.toContain('only-main.txt');

    const card = cards[0]!;
    await executeTurn({
      threadId: thread.id,
      content: `#approve ${card.id}`,
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });
    expect((await stores.approvals.get(card.id))?.status).toBe('applied');

    const featureLog = await exec('git', ['-C', repo, 'log', thread.repo!.branch, '--oneline']);
    expect(featureLog.stdout).toContain(`approve ${card.id}`);
    const mainLog = await exec('git', ['-C', repo, 'log', 'main', '--oneline']);
    expect(mainLog.stdout).not.toContain(`approve ${card.id}`);
    const mainStatus = await exec('git', ['-C', repo, 'status', '--porcelain']);
    expect(mainStatus.stdout).toContain('only-main.txt');
    expect(mainStatus.stdout).not.toContain('add.ts');
  });

  it('绑了仓库的线程跳过 sweepStrayFiles,父仓根浅文件不动', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-bound-sweep-'));
    cleanups.push(repo);
    await initScratchRepo(repo);
    const workdirBase = join(repo, 'work');
    mkdirSync(workdirBase, { recursive: true });

    const stores = createMemoryStores();
    const thread = await stores.threads.create({
      title: '跳过清扫',
      primaryAgentId: 'claude',
      workdirBase,
      repo: { path: repo, baseBranch: 'main' },
    });
    await gitWorktreeAdd(repo, thread.workdir, thread.repo!.branch, 'main');
    writeFileSync(join(repo, 'stray.js'), 'leave me\n');

    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: 's', content: '没改文件', status: 'completed' };
        },
      },
    ]);
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 看一眼',
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    expect(existsSync(join(repo, 'stray.js'))).toBe(true);
    expect(existsSync(join(thread.workdir, 'stray.js'))).toBe(false);
  });
});
