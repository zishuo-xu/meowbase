import { execFile } from 'node:child_process';
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
