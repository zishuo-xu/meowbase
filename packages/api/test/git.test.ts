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
  gitChildEnv,
  gitCommit,
  gitCurrentBranch,
  gitDiffHead,
  gitErrorReason,
  gitInit,
  gitIsRepo,
  snapshotGitState,
  describeGitMoves,
  isGitOverstep,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreePrune,
  gitWorktreeRemove,
  isApprovalNoisePath,
  isNothingToCommit,
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

function gitExecError(opts: { stdout?: string; stderr?: string; message?: string }): Error {
  const err = new Error(opts.message ?? 'Command failed: git commit -q -m approve ap_x') as Error & {
    stdout?: string;
    stderr?: string;
  };
  err.stdout = opts.stdout ?? '';
  err.stderr = opts.stderr ?? '';
  return err;
}

describe('git 辅助函数', () => {
  it('起 git 的 env 钉 LC_ALL=C,其余照旧继承', () => {
    const env = gitChildEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      GIT_ASKPASS: 'keep-me',
    });
    expect(env.LC_ALL).toBe('C');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/Users/me');
    expect(env.LANG).toBe('zh_CN.UTF-8');
    expect(env.GIT_ASKPASS).toBe('keep-me');
  });

  it('gitErrorReason 能从 stdout 取原因,跳过 On branch / Your branch / (use 噪音行', () => {
    expect(
      gitErrorReason(
        gitExecError({
          stdout: [
            'On branch meow/t',
            "Your branch is ahead of 'origin/meow/t' by 1 commit.",
            '  (use "git push" to publish your local commits)',
            '',
            'nothing to commit, working tree clean',
            '',
          ].join('\n'),
          stderr: '',
        }),
      ),
    ).toBe('nothing to commit, working tree clean');
  });

  it('isNothingToCommit 认得英文那句', () => {
    expect(isNothingToCommit('nothing to commit, working tree clean')).toBe(true);
    expect(isNothingToCommit('no changes added to commit')).toBe(true);
    expect(isNothingToCommit('Command failed: git commit -q -m approve ap_x')).toBe(false);
  });

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

  it('中文文件名原样出现在改动列表和审批 diff 里,不转义也不丢 diff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-cjk-'));
    await gitInit(dir);
    writeFileSync(join(dir, '01-设计.md'), '# 设计\n');
    expect(await gitChangedPaths(dir)).toEqual(['01-设计.md']);
    const diff = await gitDiffHead(dir);
    expect(diff).not.toBeNull();
    expect(diff?.files).toEqual(['01-设计.md']);
    expect(diff?.stat).toContain('01-设计.md');
    expect(diff?.text).toContain('+# 设计');
    expect(diff?.text).not.toContain('\\350');
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

  it('只读快照:推之前远端跟踪引用为空,推到裸仓后能读到 sha', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-git-snap-'));
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-git-bare-'));
    await initScratchRepo(repo);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    await exec('git', ['remote', 'add', 'origin', bare], { cwd: repo });

    const before = await snapshotGitState(repo, { baseBranch: 'main' });
    expect(before.branch).toBe('main');
    expect(before.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(before.remoteName).toBe('origin');
    expect(before.remoteTrackingSha).toBeUndefined();
    expect(before.baseRemoteTrackingSha).toBeUndefined();
    expect(before.baseLocalSha).toBe(before.headSha);

    await exec('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });
    const after = await snapshotGitState(repo, { baseBranch: 'main' });
    expect(after.remoteTrackingSha).toBe(after.headSha);
    expect(after.baseRemoteTrackingSha).toBe(after.headSha);
    expect(after.aheadCount).toBe(0);
    rmSync(repo, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it('没有配 remote 的仓探测不炸,远端字段为空', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-git-noremote-'));
    await initScratchRepo(repo);
    const snap = await snapshotGitState(repo, { baseBranch: 'main' });
    expect(snap.branch).toBe('main');
    expect(snap.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.remoteName).toBeUndefined();
    expect(snap.remoteTrackingSha).toBeUndefined();
    expect(snap.baseRemoteTrackingSha).toBeUndefined();
    expect(snap.baseLocalSha).toBe(snap.headSha);
    rmSync(repo, { recursive: true, force: true });
  });

  it('worktree 能看见父仓本地基准分支 sha', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-git-baselocal-'));
    const work = mkdtempSync(join(tmpdir(), 'meowbase-git-baselocal-wt-'));
    await initScratchRepo(repo);
    const parent = await snapshotGitState(repo, { baseBranch: 'main' });
    expect(parent.baseLocalSha).toBe(parent.headSha);
    await gitWorktreeAdd(repo, work, 'meow/t-baselocal', 'main');
    const wt = await snapshotGitState(work, { baseBranch: 'main' });
    expect(wt.branch).toBe('meow/t-baselocal');
    expect(wt.headSha).toBe(parent.headSha);
    expect(wt.baseLocalSha).toBe(parent.headSha);
    rmSync(work, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('自己那根前进不越界,基准远端或本地动了才越界', () => {
    const before = {
      branch: 'meow/t',
      headSha: 'aaa',
      remoteName: 'origin',
      remoteTrackingSha: 'aaa',
      baseRemoteTrackingSha: 'mmm',
      baseLocalSha: 'mmm',
      aheadCount: 1,
    };
    const afterOwn = { ...before, headSha: 'bbb', remoteTrackingSha: 'bbb', aheadCount: 2 };
    const own = describeGitMoves({
      before,
      after: afterOwn,
      commitsSinceBefore: 1,
      agentName: '墨墨',
      baseBranch: 'main',
      allowRemote: true,
    });
    expect(isGitOverstep(before, afterOwn)).toBe(false);
    expect(own.oversteps).toEqual([]);
    expect(own.notes.some((n) => n.includes('提交了') && n.includes('commit'))).toBe(true);
    expect(own.notes.some((n) => n.includes('推到了 origin'))).toBe(true);

    const afterRemote = { ...before, baseRemoteTrackingSha: 'nnn' };
    const remote = describeGitMoves({
      before,
      after: afterRemote,
      commitsSinceBefore: 0,
      agentName: '墨墨',
      baseBranch: 'main',
    });
    expect(isGitOverstep(before, afterRemote)).toBe(true);
    expect(remote.notes).toEqual([]);
    expect(remote.oversteps).toEqual([
      {
        side: 'remote',
        baseBranch: 'main',
        beforeSha: 'mmm',
        afterSha: 'nnn',
        note: '⚠️ 基准分支 `main` 的远端引用变了',
      },
    ]);

    const afterLocal = { ...before, baseLocalSha: 'nnn' };
    const local = describeGitMoves({
      before,
      after: afterLocal,
      commitsSinceBefore: 0,
      agentName: '墨墨',
      baseBranch: 'main',
    });
    expect(isGitOverstep(before, afterLocal)).toBe(true);
    expect(local.notes).toEqual([]);
    expect(local.oversteps).toEqual([
      {
        side: 'local',
        baseBranch: 'main',
        beforeSha: 'mmm',
        afterSha: 'nnn',
        note: '⚠️ 基准分支 `main` 的本地引用变了',
      },
    ]);
  });

  it('本地模式推自己这根算越界,越界闸本身仍只看基准分支', () => {
    const before = {
      branch: 'meow/t',
      headSha: 'aaa',
      remoteName: 'origin',
      remoteTrackingSha: 'aaa',
      baseRemoteTrackingSha: 'mmm',
      baseLocalSha: 'mmm',
      aheadCount: 1,
    };
    const afterOwn = { ...before, headSha: 'bbb', remoteTrackingSha: 'bbb', aheadCount: 2 };
    expect(isGitOverstep(before, afterOwn)).toBe(false);

    const missing = describeGitMoves({
      before,
      after: afterOwn,
      commitsSinceBefore: 1,
      agentName: '墨墨',
      baseBranch: 'main',
    });
    expect(missing.oversteps).toEqual([
      {
        side: 'push',
        baseBranch: 'main',
        beforeSha: 'aaa',
        afterSha: 'bbb',
        note: '⚠️ 本线程是本地模式,不该推送。`meow/t` 的远端跟踪引用变了',
      },
    ]);

    const local = describeGitMoves({
      before,
      after: afterOwn,
      commitsSinceBefore: 1,
      agentName: '墨墨',
      baseBranch: 'main',
      allowRemote: false,
    });
    expect(local.oversteps).toEqual(missing.oversteps);

    const afterBase = { ...before, baseLocalSha: 'nnn' };
    expect(isGitOverstep(before, afterBase)).toBe(true);
    const stillBase = describeGitMoves({
      before,
      after: afterBase,
      commitsSinceBefore: 0,
      agentName: '墨墨',
      baseBranch: 'main',
      allowRemote: false,
    });
    expect(stillBase.oversteps).toEqual([
      {
        side: 'local',
        baseBranch: 'main',
        beforeSha: 'mmm',
        afterSha: 'nnn',
        note: '⚠️ 基准分支 `main` 的本地引用变了',
      },
    ]);
  });
});
