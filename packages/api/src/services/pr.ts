import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const GH_TIMEOUT_MS = 15_000;

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED';

export interface PrSnapshot {
  number: number;
  state: PrState;
  url: string;
  headRefOid: string;
}

export type PrLookupResult =
  | { ok: true; pr: PrSnapshot | null }
  | { ok: false; reason: string };

export type PrLookup = (input: { workdir: string; head: string }) => Promise<PrLookupResult>;

export interface PrMergeStop {
  number: number;
  url: string;
  headRefOid: string;
  note: string;
}

export function isPrMerged(pr: PrSnapshot | null | undefined): boolean {
  return pr?.state === 'MERGED';
}

export function formatPrOpenedNote(input: {
  agentName: string;
  branch: string;
  number: number;
  url: string;
}): string {
  return `${input.agentName} 对自己这根 \`${input.branch}\` 开了 PR #${input.number}：${input.url}`;
}

export function formatPrMergedNote(input: { number: number; url?: string }): string {
  return input.url
    ? `⚠️ PR #${input.number} 已被合并：${input.url}`
    : `⚠️ PR #${input.number} 已被合并`;
}

export function formatPrLookupFailedNote(reason: string): string {
  return `查不到 PR 状态(${reason})`;
}

function errorText(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const stderr = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : '';
  const message = err instanceof Error ? err.message : '';
  return `${stderr}\n${message}`.trim();
}

export function classifyPrLookupError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
    return 'gh 没装';
  }
  const text = errorText(err);
  if (/auth login|authentication token|not logged|HTTP 401|Bad credentials|gh auth/i.test(text)) {
    return '没登录';
  }
  if (/not a github|none of the git remotes|not.*GitHub (host|repository)/i.test(text)) {
    return '远端不是 GitHub';
  }
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err.code === 'ENOTFOUND' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'EAI_AGAIN')
  ) {
    return '断网';
  }
  if (/network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(text)) {
    return '断网';
  }
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean);
  return (line ?? '查询失败').slice(0, 80);
}

export function parsePrListJson(raw: string): PrSnapshot[] | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    const out: PrSnapshot[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.number !== 'number') continue;
      const state = String(row.state ?? '').toUpperCase();
      if (state !== 'OPEN' && state !== 'MERGED' && state !== 'CLOSED') continue;
      if (typeof row.url !== 'string' || typeof row.headRefOid !== 'string') continue;
      out.push({
        number: row.number,
        state,
        url: row.url,
        headRefOid: row.headRefOid,
      });
    }
    if (data.length > 0 && out.length === 0) return null;
    return out;
  } catch {
    return null;
  }
}

function pickPr(list: PrSnapshot[]): PrSnapshot | null {
  return list.find((item) => item.state === 'MERGED') ?? list[0] ?? null;
}

async function remoteLooksLikeGitHub(workdir: string): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['remote', '-v'], { cwd: workdir });
    return /github\.com/i.test(stdout);
  } catch {
    return false;
  }
}

export async function lookupPr(input: {
  workdir: string;
  head: string;
  ghBin?: string;
}): Promise<PrLookupResult> {
  if (!(await remoteLooksLikeGitHub(input.workdir))) {
    return { ok: false, reason: '远端不是 GitHub' };
  }
  const bin = input.ghBin ?? 'gh';
  try {
    const { stdout } = await exec(
      bin,
      ['pr', 'list', '--head', input.head, '--state', 'all', '--json', 'number,state,url,headRefOid'],
      { cwd: input.workdir, timeout: GH_TIMEOUT_MS },
    );
    const parsed = parsePrListJson(stdout);
    if (!parsed) return { ok: false, reason: '返回不是 JSON' };
    return { ok: true, pr: pickPr(parsed) };
  } catch (err) {
    return { ok: false, reason: classifyPrLookupError(err) };
  }
}

export function createMergedPrLookup(): PrLookup {
  return async ({ workdir }) => {
    let headRefOid = 'a'.repeat(40);
    try {
      const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: workdir });
      const sha = stdout.trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) headRefOid = sha;
    } catch {
      // 记分板假源:读不到 HEAD 就用占位 sha
    }
    return {
      ok: true,
      pr: {
        number: 42,
        state: 'MERGED',
        url: 'https://github.com/example/repo/pull/42',
        headRefOid,
      },
    };
  };
}

export function resolvePrLookup(env: NodeJS.ProcessEnv = process.env): PrLookup {
  if (env.MEOW_PR_FAKE === 'merged') return createMergedPrLookup();
  return (input) => lookupPr(input);
}
