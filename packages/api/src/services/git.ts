import { execFile } from 'node:child_process';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ThreadRepo } from '@meowbase/shared';

const exec = promisify(execFile);

const SANDBOX_GITIGNORE = `*.tsbuildinfo
.DS_Store
Thumbs.db
*.log
.eslintcache
node_modules/
`;

const NOISE_RESET_PATHS = [
  '*.tsbuildinfo',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '.eslintcache',
  'node_modules',
];

export function isApprovalNoisePath(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.includes('node_modules')) return true;
  const base = basename(path);
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === '.eslintcache') return true;
  if (base.endsWith('.tsbuildinfo') || base.endsWith('.log')) return true;
  return false;
}

/** 起 git 时只加 LC_ALL=C,其余 env 照旧继承。裁 env 会伤凭据,那是另一篇的事。 */
export function gitChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, LC_ALL: 'C' };
}

async function run(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: dir, env: gitChildEnv() });
  return stdout;
}

async function tryRun(dir: string, args: string[]): Promise<string | undefined> {
  try {
    const out = (await run(dir, args)).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export interface GitStateSnapshot {
  branch: string;
  headSha: string;
  remoteName?: string;
  remoteTrackingSha?: string;
  baseRemoteTrackingSha?: string;
  /** worktree 和父仓共享 refs,所以这里看见的是人主仓那根基准分支 */
  baseLocalSha?: string;
  aheadCount: number;
}

export interface GitOverstep {
  side: 'remote' | 'local' | 'push';
  baseBranch: string;
  beforeSha?: string;
  afterSha?: string;
  note: string;
}

export interface GitMoveClassification {
  notes: string[];
  oversteps: GitOverstep[];
}

async function firstRemoteName(dir: string): Promise<string | undefined> {
  const raw = await tryRun(dir, ['remote']);
  if (!raw) return undefined;
  const remotes = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (remotes.includes('origin')) return 'origin';
  return remotes[0];
}

/** 线程 workdir 的只读 git 快照。不 fetch、不联网。某条 ref 不存在则对应字段为空。 */
export async function snapshotGitState(
  dir: string,
  opts?: { baseBranch?: string },
): Promise<GitStateSnapshot> {
  const branch = (await tryRun(dir, ['branch', '--show-current'])) ?? '';
  const headSha = (await tryRun(dir, ['rev-parse', 'HEAD'])) ?? '';
  const remoteName = await firstRemoteName(dir);
  const remoteTrackingSha =
    remoteName && branch
      ? await tryRun(dir, ['rev-parse', `refs/remotes/${remoteName}/${branch}`])
      : undefined;
  const baseRemoteTrackingSha =
    remoteName && opts?.baseBranch
      ? await tryRun(dir, ['rev-parse', `refs/remotes/${remoteName}/${opts.baseBranch}`])
      : undefined;
  const baseLocalSha = opts?.baseBranch
    ? await tryRun(dir, ['rev-parse', `refs/heads/${opts.baseBranch}`])
    : undefined;
  let aheadCount = 0;
  if (opts?.baseBranch && headSha) {
    const counted = await tryRun(dir, ['rev-list', '--count', `${opts.baseBranch}..HEAD`]);
    if (counted) aheadCount = Number.parseInt(counted, 10) || 0;
  }
  return {
    branch,
    headSha,
    ...(remoteName ? { remoteName } : {}),
    ...(remoteTrackingSha ? { remoteTrackingSha } : {}),
    ...(baseRemoteTrackingSha ? { baseRemoteTrackingSha } : {}),
    ...(baseLocalSha ? { baseLocalSha } : {}),
    aheadCount,
  };
}

export async function countCommitsBetween(
  dir: string,
  fromSha: string,
  toSha: string,
): Promise<number> {
  if (!fromSha || !toSha || fromSha === toSha) return 0;
  const counted = await tryRun(dir, ['rev-list', '--count', `${fromSha}..${toSha}`]);
  return counted ? Number.parseInt(counted, 10) || 0 : 0;
}

/** 基准分支的远端跟踪引用或本地 ref 动了。自己那根前进(含被 force 改写)不算越界。 */
export function isGitOverstep(before: GitStateSnapshot, after: GitStateSnapshot): boolean {
  return (
    after.baseRemoteTrackingSha !== before.baseRemoteTrackingSha ||
    after.baseLocalSha !== before.baseLocalSha
  );
}

export function describeGitMoves(input: {
  before: GitStateSnapshot;
  after: GitStateSnapshot;
  commitsSinceBefore: number;
  agentName: string;
  baseBranch?: string;
  allowRemote?: boolean;
}): GitMoveClassification {
  const notes: string[] = [];
  const oversteps: GitOverstep[] = [];
  const branch = input.after.branch || input.before.branch;
  if (input.commitsSinceBefore > 0) {
    notes.push(
      `${input.agentName} 在 \`${branch}\` 上提交了 ${input.commitsSinceBefore} 个 commit`,
    );
  }
  if (
    input.after.remoteTrackingSha &&
    input.after.remoteTrackingSha !== input.before.remoteTrackingSha
  ) {
    const remote = input.after.remoteName ?? input.before.remoteName ?? 'origin';
    notes.push(`${input.agentName} 把 \`${branch}\` 推到了 ${remote}`);
    if (!input.allowRemote) {
      oversteps.push({
        side: 'push',
        baseBranch: input.baseBranch ?? 'main',
        ...(input.before.remoteTrackingSha
          ? { beforeSha: input.before.remoteTrackingSha }
          : {}),
        afterSha: input.after.remoteTrackingSha,
        note: `⚠️ 本线程是本地模式,不该推送。\`${branch}\` 的远端跟踪引用变了`,
      });
    }
  }
  const baseBranch = input.baseBranch ?? 'main';
  if (isGitOverstep(input.before, input.after)) {
    if (input.after.baseRemoteTrackingSha !== input.before.baseRemoteTrackingSha) {
      oversteps.push({
        side: 'remote',
        baseBranch,
        ...(input.before.baseRemoteTrackingSha
          ? { beforeSha: input.before.baseRemoteTrackingSha }
          : {}),
        ...(input.after.baseRemoteTrackingSha
          ? { afterSha: input.after.baseRemoteTrackingSha }
          : {}),
        note: `⚠️ 基准分支 \`${baseBranch}\` 的远端引用变了`,
      });
    }
    if (input.after.baseLocalSha !== input.before.baseLocalSha) {
      oversteps.push({
        side: 'local',
        baseBranch,
        ...(input.before.baseLocalSha ? { beforeSha: input.before.baseLocalSha } : {}),
        ...(input.after.baseLocalSha ? { afterSha: input.after.baseLocalSha } : {}),
        note: `⚠️ 基准分支 \`${baseBranch}\` 的本地引用变了`,
      });
    }
  }
  return { notes, oversteps };
}

export async function gitIsRepo(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false;
  try {
    return (await run(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function gitCurrentBranch(dir: string): Promise<string> {
  return (await run(dir, ['branch', '--show-current'])).trim();
}

export async function gitBranchExists(dir: string, branch: string): Promise<boolean> {
  try {
    await run(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function gitWorktreeAdd(
  repoPath: string,
  workdir: string,
  branch: string,
  baseBranch: string,
): Promise<void> {
  await run(repoPath, ['worktree', 'add', workdir, '-b', branch, baseBranch]);
}

export async function gitWorktreeRemove(repoPath: string, workdir: string): Promise<void> {
  await run(repoPath, ['worktree', 'remove', '--force', workdir]);
}

export async function gitWorktreePrune(repoPath: string): Promise<void> {
  await run(repoPath, ['worktree', 'prune']);
}

export async function gitWorktreeList(repoPath: string): Promise<string[]> {
  const out = await run(repoPath, ['worktree', 'list', '--porcelain']);
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length).trim()));
}

export async function gitInit(dir: string): Promise<void> {
  await run(dir, ['init', '-q']);
  await run(dir, ['config', 'user.name', 'meowbase']);
  await run(dir, ['config', 'user.email', 'meowbase@local']);
  writeFileSync(join(dir, '.gitignore'), SANDBOX_GITIGNORE);
  // 基线提交包含沙箱骨架文件(如 package.json),避免其成为首轮 diff
  await run(dir, ['add', '-A']);
  await run(dir, ['commit', '--allow-empty', '-q', '-m', 'baseline']);
}

export async function gitAddAll(dir: string): Promise<void> {
  await run(dir, ['add', '-A']);
  try {
    await run(dir, ['reset', '-q', '--', ...NOISE_RESET_PATHS]);
  } catch {
    // 没有匹配文件时 git reset 可能非零
  }
}

export async function gitHeadSha(dir: string): Promise<string | undefined> {
  return tryRun(dir, ['rev-parse', 'HEAD']);
}

/** 绑仓线程的审批/交接 diff 基准:上次批准的 HEAD,否则与基准分支的分叉点。空沙箱用 HEAD。 */
export async function resolveDiffMarker(dir: string, repo?: ThreadRepo): Promise<string> {
  if (!repo) return 'HEAD';
  if (repo.lastApprovedSha) return repo.lastApprovedSha;
  return (await tryRun(dir, ['merge-base', repo.baseBranch, 'HEAD'])) ?? 'HEAD';
}

export async function gitChangedPaths(dir: string, fromRef = 'HEAD'): Promise<string[]> {
  await gitAddAll(dir);
  // quotepath=false:中文名不转成八进制转义,否则列表显示乱码,拿它当 pathspec 也匹配不到文件
  return (await run(dir, ['-c', 'core.quotepath=false', 'diff', fromRef, '--name-only', '--', '.']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !isApprovalNoisePath(path));
}

export async function gitDiffHead(
  dir: string,
  fromRef = 'HEAD',
): Promise<{ stat: string; text: string; files: string[] } | null> {
  const names = (
    await run(dir, ['-c', 'core.quotepath=false', 'diff', fromRef, '--name-only', '--', '.'])
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !isApprovalNoisePath(path));
  if (names.length === 0) return null;
  const text = await run(dir, ['-c', 'core.quotepath=false', 'diff', fromRef, '--', ...names]);
  if (!text.trim()) return null;
  const stat = await run(dir, ['-c', 'core.quotepath=false', 'diff', fromRef, '--stat', '--', ...names]);
  return { stat: stat.trim(), text: text.slice(0, 20_000), files: names };
}

export async function gitCommit(dir: string, message: string): Promise<void> {
  await run(dir, ['commit', '-q', '-m', message]);
}

function pickGitReasonLine(text: string): string | undefined {
  return text
    .split('\n')
    .map((item) => item.trim())
    .find(
      (item) =>
        item &&
        !item.startsWith('On branch') &&
        !item.startsWith('Your branch') &&
        !item.startsWith('(use '),
    );
}

export function gitErrorReason(err: unknown): string {
  if (err && typeof err === 'object') {
    const stderr = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr.trim() : '';
    const stdout = 'stdout' in err && typeof err.stdout === 'string' ? err.stdout.trim() : '';
    const line = pickGitReasonLine(stderr) ?? pickGitReasonLine(stdout);
    if (line) return line;
    if (err instanceof Error && err.message) return err.message;
  }
  return String(err);
}

export function isNothingToCommit(reason: string): boolean {
  return /nothing to commit|no changes added to commit/i.test(reason);
}

export type LandApprovalResult =
  | { ok: true; headSha: string }
  | { ok: false; reason: string };

/**
 * 尝试把批准落成一次 commit。失败(含 nothing to commit)默认不落地。
 * 绑仓且工作区干净、HEAD 已越过 marker 时,改动已经在历史上,算落地(前进 marker 即可)。
 */
export async function tryLandApproval(input: {
  dir: string;
  message: string;
  repo?: ThreadRepo;
}): Promise<LandApprovalResult> {
  try {
    await gitCommit(input.dir, input.message);
    const headSha = (await gitHeadSha(input.dir)) ?? '';
    return { ok: true, headSha };
  } catch (err) {
    const reason = gitErrorReason(err);
    if (input.repo && isNothingToCommit(reason)) {
      const dirty = (await gitStatusPorcelain(input.dir)).trim();
      const headSha = await gitHeadSha(input.dir);
      const marker = await resolveDiffMarker(input.dir, input.repo);
      if (!dirty && headSha && headSha !== marker) {
        return { ok: true, headSha };
      }
    }
    return { ok: false, reason };
  }
}

export async function gitStatusPorcelain(dir: string): Promise<string> {
  return run(dir, ['status', '--porcelain', '--untracked-files=all']);
}

/** 从 porcelain 输出中解析散落产物:仓库根或包根的未跟踪文件,不碰 src/test 源码树。 */
export function parseStrayFiles(statusText: string, workPrefix = 'work/'): string[] {
  return statusText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter((path) => isStrayAgentPath(path, workPrefix));
}

function isKeptProjectFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (base.startsWith('.')) return true;
  if (/\.(config|lock)\.(json|ts|mjs|yaml|yml)$/.test(base)) return true;
  return [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'README.md',
    'AGENTS.md',
    'biome.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'meowbase.config.json',
  ].includes(base);
}

function isStrayAgentPath(path: string, workPrefix: string): boolean {
  if (!path || path.startsWith(workPrefix)) return false;
  if (isKeptProjectFile(path)) return false;
  const parts = path.split('/');
  if (parts.length === 1) return true;
  // CLI 上溯时可能写到 packages/<pkg>/filename
  if (parts.length === 3 && parts[0] === 'packages') return true;
  return false;
}

/**
 * 沙箱清扫:agent 若把文件写到仓库根(沙箱外),移回线程沙箱。
 * 仅处理未跟踪文件;仓库根不是 git 仓库时静默跳过。
 */
export async function sweepStrayFiles(
  repoRoot: string,
  workdir: string,
): Promise<string[]> {
  let status: string;
  try {
    status = await gitStatusPorcelain(repoRoot);
  } catch {
    return [];
  }
  const strays = parseStrayFiles(status);
  const moved: string[] = [];
  for (const path of strays) {
    const src = join(repoRoot, path);
    if (!existsSync(src)) continue;
    const dest = join(workdir, basename(path));
    try {
      renameSync(src, dest);
      moved.push(path);
    } catch {
      // 移动失败不阻塞
    }
  }
  if (moved.length > 0) {
    console.warn(`sweepStrayFiles: 移回沙箱 ${moved.join(', ')}`);
  }
  return moved;
}
