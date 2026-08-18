import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  gitAddAll,
  gitBranchExists,
  gitChangedPaths,
  gitCommit,
  gitCurrentBranch,
  gitDiffHead,
  gitInit,
  gitIsRepo,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreePrune,
  gitWorktreeRemove,
  isApprovalNoisePath,
  parseStrayFiles,
  sweepStrayFiles,
} from '../src/services/git.js';

const exec = promisify(execFile);

const USER_GITIGNORE = 'node_modules/\n*.env\n';

async function initScratchRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), USER_GITIGNORE);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'scratch', private: true, type: 'module' }, null, 2),
  );
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

describe('git 辅助函数', () => {
  it('init 空基线;新增文件后 diff 非空;commit 后 diff 为空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-'));
    await gitInit(dir);
    expect(await gitDiffHead(dir)).toBeNull();

    writeFileSync(join(dir, 'a.txt'), 'hello');
    await gitAddAll(dir);
    const diff = await gitDiffHead(dir);
    expect(diff).not.toBeNull();
    expect(diff?.stat).toContain('a.txt');
    expect(diff?.text).toContain('+hello');

    await gitCommit(dir, 'baseline');
    expect(await gitDiffHead(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('gitChangedPaths 列出相对 HEAD 的改动文件,过滤噪声', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-paths-'));
    await gitInit(dir);
    writeFileSync(join(dir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '{"version":"5"}');
    expect(await gitChangedPaths(dir)).toEqual(['add.ts']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('node_modules 不进入审批 diff 和交接文件列表', async () => {
    expect(isApprovalNoisePath('node_modules')).toBe(true);
    expect(isApprovalNoisePath('node_modules/typescript/package.json')).toBe(true);
    expect(isApprovalNoisePath('src/app.ts')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-nm-'));
    await gitInit(dir);
    writeFileSync(join(dir, 'lru.ts'), 'export const n = 1;\n');
    mkdirSync(join(dir, 'node_modules', 'typescript'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript"}\n');
    expect(await gitChangedPaths(dir)).toEqual(['lru.ts']);
    const diff = await gitDiffHead(dir);
    expect(diff?.stat).toContain('lru.ts');
    expect(diff?.stat).not.toContain('node_modules');
    rmSync(dir, { recursive: true, force: true });
  });

  it('tsbuildinfo 等缓存文件不进入审批 diff', async () => {
    expect(isApprovalNoisePath('packages/web/tsconfig.tsbuildinfo')).toBe(true);
    expect(isApprovalNoisePath('src/app.ts')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-noise-'));
    await gitInit(dir);
    writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '{"version":"5"}');
    writeFileSync(join(dir, '.DS_Store'), 'junk');
    writeFileSync(join(dir, 'app.ts'), 'export const n = 1;\n');
    await gitAddAll(dir);
    const diff = await gitDiffHead(dir);
    expect(diff?.stat).toContain('app.ts');
    expect(diff?.stat).not.toContain('tsbuildinfo');
    expect(diff?.stat).not.toContain('.DS_Store');
    writeFileSync(join(dir, 'only.tsbuildinfo'), 'x');
    await gitAddAll(dir);
    await gitCommit(dir, 'app');
    writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '{"version":"6"}');
    await gitAddAll(dir);
    expect(await gitDiffHead(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('parseStrayFiles 只取未跟踪且不在 work/ 下的文件', () => {
    const status = [
      '?? packages/api/mul.js',
      '?? work/abc/x.txt',
      ' M packages/api/edited.js',
      '?? 另一个.txt',
      '',
    ].join('\n');
    expect(parseStrayFiles(status)).toEqual(['packages/api/mul.js', '另一个.txt']);
  });

  it('parseStrayFiles 不碰源码树里的未跟踪文件', () => {
    const status = [
      '?? packages/api/src/providers/gemini.ts',
      '?? packages/api/test/gemini-json.test.ts',
      '?? packages/api/test/fixtures/fake-gemini.mjs',
      '?? docs/notes.md',
      '?? mul.js',
      '?? packages/api/mul.js',
    ].join('\n');
    expect(parseStrayFiles(status)).toEqual(['mul.js', 'packages/api/mul.js']);
  });

  it('parseStrayFiles 不碰仓库配置文件', () => {
    const status = [
      '?? meowbase.config.json',
      '?? package.json',
      '?? mul.js',
    ].join('\n');
    expect(parseStrayFiles(status)).toEqual(['mul.js']);
  });

  it('sweepStrayFiles 把散落文件移回沙箱', async () => {
    const root = mkdtempSync(join(tmpdir(), 'meowbase-sweep-'));
    await gitInit(root);
    const workdir = join(root, 'work', 't1');
    mkdirSync(workdir, { recursive: true });
    await gitInit(workdir);

    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    writeFileSync(join(root, 'packages', 'api', 'stray.js'), 'x');
    const moved = await sweepStrayFiles(root, workdir);
    expect(moved).toContain('packages/api/stray.js');
    expect(existsSync(join(workdir, 'stray.js'))).toBe(true);
    expect(existsSync(join(root, 'packages', 'api', 'stray.js'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('worktree add 在 meow/<id> 上建工作区;remove 清登记;不改父仓 .gitignore', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-wt-repo-'));
    await initScratchRepo(repo);
    const threadId = 'wt-test-id';
    const workdir = join(mkdtempSync(join(tmpdir(), 'meowbase-wt-base-')), threadId);
    const branch = `meow/${threadId}`;

    expect(await gitIsRepo(repo)).toBe(true);
    expect(await gitCurrentBranch(repo)).toBe('main');
    expect(await gitBranchExists(repo, 'main')).toBe(true);
    expect(await gitBranchExists(repo, branch)).toBe(false);

    await gitWorktreeAdd(repo, workdir, branch, 'main');
    expect(existsSync(workdir)).toBe(true);
    expect(await gitCurrentBranch(workdir)).toBe(branch);
    expect(await gitBranchExists(repo, branch)).toBe(true);
    const listed = await gitWorktreeList(repo);
    expect(listed.some((p) => p === workdir || p.endsWith(threadId))).toBe(true);
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe(USER_GITIGNORE);
    expect(readFileSync(join(workdir, '.gitignore'), 'utf8')).toBe(USER_GITIGNORE);
    expect(readFileSync(join(workdir, '.gitignore'), 'utf8')).not.toContain('*.tsbuildinfo');

    await gitWorktreeRemove(repo, workdir);
    expect(existsSync(workdir)).toBe(false);
    const after = await gitWorktreeList(repo);
    expect(after.some((p) => p === workdir || p.endsWith(threadId))).toBe(false);
    expect(await gitBranchExists(repo, branch)).toBe(true);
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe(USER_GITIGNORE);

    await gitWorktreePrune(repo);
    rmSync(repo, { recursive: true, force: true });
  });
});
