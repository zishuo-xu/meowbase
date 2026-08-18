import { execFile } from 'node:child_process';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

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

async function run(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: dir });
  return stdout;
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

export async function gitChangedPaths(dir: string): Promise<string[]> {
  await gitAddAll(dir);
  return (await run(dir, ['diff', 'HEAD', '--name-only', '--', '.']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !isApprovalNoisePath(path));
}

export async function gitDiffHead(dir: string): Promise<{ stat: string; text: string } | null> {
  const names = (await run(dir, ['diff', 'HEAD', '--name-only', '--', '.']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !isApprovalNoisePath(path));
  if (names.length === 0) return null;
  const text = await run(dir, ['diff', 'HEAD', '--', ...names]);
  if (!text.trim()) return null;
  const stat = await run(dir, ['diff', 'HEAD', '--stat', '--', ...names]);
  return { stat: stat.trim(), text: text.slice(0, 20_000) };
}

export async function gitCommit(dir: string, message: string): Promise<void> {
  await run(dir, ['commit', '-q', '-m', message]);
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
