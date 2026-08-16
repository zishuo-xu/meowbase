import { execFile } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function run(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: dir });
  return stdout;
}

export async function gitInit(dir: string): Promise<void> {
  await run(dir, ['init', '-q']);
  await run(dir, ['config', 'user.name', 'meowbase']);
  await run(dir, ['config', 'user.email', 'meowbase@local']);
  // 基线提交包含沙箱骨架文件(如 package.json),避免其成为首轮 diff
  await run(dir, ['add', '-A']);
  await run(dir, ['commit', '--allow-empty', '-q', '-m', 'baseline']);
}

export async function gitAddAll(dir: string): Promise<void> {
  await run(dir, ['add', '-A']);
}

export async function gitDiffHead(dir: string): Promise<{ stat: string; text: string } | null> {
  const text = await run(dir, ['diff', 'HEAD', '--', '.']);
  if (!text.trim()) return null;
  const stat = await run(dir, ['diff', 'HEAD', '--stat']);
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

function isStrayAgentPath(path: string, workPrefix: string): boolean {
  if (!path || path.startsWith(workPrefix)) return false;
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
