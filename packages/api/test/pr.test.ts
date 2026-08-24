import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyPrLookupError,
  formatPrLookupFailedNote,
  formatApprovalVoidReason,
  formatApprovalVoidedNote,
  formatApproveVoidedReply,
  isPrMerged,
  lookupPr,
  parsePrListJson,
} from '../src/services/pr.js';

const exec = promisify(execFile);

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function scratchRepo(remoteUrl?: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'meowbase-pr-'));
  cleanups.push(dir);
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'x\n');
  await exec('git', ['add', 'README.md'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  if (remoteUrl) {
    await exec('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir });
  }
  return dir;
}

function writeFakeGh(dir: string, json: string): string {
  const bin = join(dir, 'fake-gh');
  writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(json)});\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('isPrMerged', () => {
  it('只认 MERGED,OPEN / CLOSED / 空都不是', () => {
    expect(isPrMerged({ number: 1, state: 'MERGED', url: 'https://x/1', headRefOid: 'a'.repeat(40) })).toBe(
      true,
    );
    expect(isPrMerged({ number: 1, state: 'OPEN', url: 'https://x/1', headRefOid: 'a'.repeat(40) })).toBe(
      false,
    );
    expect(isPrMerged({ number: 1, state: 'CLOSED', url: 'https://x/1', headRefOid: 'a'.repeat(40) })).toBe(
      false,
    );
    expect(isPrMerged(null)).toBe(false);
  });
});

describe('查不到 ≠ 没有', () => {
  it('四种失败都归到查不到,空列表才是没有 PR', () => {
    expect(classifyPrLookupError(Object.assign(new Error('spawn gh'), { code: 'ENOENT' }))).toBe(
      'gh 没装',
    );
    expect(classifyPrLookupError(new Error('To get started with GitHub CLI, please run:  gh auth login'))).toBe(
      '没登录',
    );
    expect(classifyPrLookupError(new Error('none of the git remotes configured for this repository point to a GitHub host'))).toBe(
      '远端不是 GitHub',
    );
    expect(classifyPrLookupError(Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' }))).toBe(
      '断网',
    );

    expect(parsePrListJson('[]')).toEqual([]);
    expect(formatPrLookupFailedNote('gh 没装')).toBe('查不到 PR 状态(gh 没装)');
    expect(formatPrLookupFailedNote('gh 没装')).not.toContain('没有 PR');
  });

  it('gh 没装:失败结果不是「没有 PR」', async () => {
    const dir = await scratchRepo('https://github.com/example/repo.git');
    const result = await lookupPr({
      workdir: dir,
      head: 'meow/t1',
      ghBin: join(dir, 'definitely-not-gh'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('gh 没装');
    expect(result.reason).not.toMatch(/没有/);
  });

  it('远端不是 GitHub:失败结果不是「没有 PR」', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-pr-bare-'));
    cleanups.push(bare);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    const dir = await scratchRepo(bare);
    const result = await lookupPr({ workdir: dir, head: 'meow/t1' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('远端不是 GitHub');
    expect(result.reason).not.toMatch(/没有/);
  });

  it('没登录 / 断网:失败结果不是「没有 PR」', () => {
    const auth = classifyPrLookupError({
      stderr: 'error: your authentication token is invalid\nHTTP 401',
    });
    expect(auth).toBe('没登录');
    expect(auth).not.toMatch(/没有/);
    const net = classifyPrLookupError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' });
    expect(net).toBe('断网');
    expect(net).not.toMatch(/没有/);
  });

  it('真查到空列表才是没有 PR', async () => {
    const dir = await scratchRepo('https://github.com/example/repo.git');
    const ghBin = writeFakeGh(dir, '[]');
    const result = await lookupPr({ workdir: dir, head: 'meow/t1', ghBin });
    expect(result).toEqual({ ok: true, pr: null });
  });

  it('作废文案带卡号和 PR number', () => {
    expect(formatApprovalVoidReason(12)).toBe('PR #12 已合并');
    expect(formatApprovalVoidedNote({ cardId: 'ap_a1b2c3d4', reason: 'PR #12 已合并' })).toBe(
      '📋 审批卡片 ap_a1b2c3d4 已失效(PR #12 已合并)',
    );
    expect(formatApproveVoidedReply({ cardId: 'ap_a1b2c3d4', reason: 'PR #12 已合并' })).toBe(
      '⚠️ 这张卡已失效:ap_a1b2c3d4（PR #12 已合并）',
    );
  });
});
