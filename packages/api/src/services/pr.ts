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

export function formatApprovalVoidReason(prNumber: number): string {
  return `PR #${prNumber} 已合并`;
}

export function formatApprovalVoidedNote(input: { cardId: string; reason: string }): string {
  return `📋 审批卡片 ${input.cardId} 已失效(${input.reason})`;
}

export function formatApproveVoidedReply(input: { cardId: string; reason: string }): string {
  return `⚠️ 这张卡已失效:${input.cardId}（${input.reason}）`;
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

export function createOpenPrLookup(): PrLookup {
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
        state: 'OPEN',
        url: 'https://github.com/example/repo/pull/42',
        headRefOid,
      },
    };
  };
}

export type PrReviewAuthorType = 'User' | 'Bot' | 'Other';

export interface PrReviewItem {
  id: string;
  author: string;
  authorType: PrReviewAuthorType;
  body: string;
  htmlUrl?: string;
  submittedAt?: string;
}

export interface PrReviewRef {
  item: PrReviewItem;
  prNumber: number;
  prUrl: string;
}

export type PrReviewListResult =
  | { ok: true; items: PrReviewItem[] }
  | { ok: false; reason: string };

export type PrReviewList = (input: { workdir: string; number: number }) => Promise<PrReviewListResult>;

function toAuthorType(raw: unknown): PrReviewAuthorType {
  return raw === 'User' || raw === 'Bot' ? raw : 'Other';
}

export function parsePrReviewJson(rawComments: string, rawReviews: string): PrReviewItem[] | null {
  try {
    const comments = JSON.parse(rawComments) as unknown;
    const reviews = JSON.parse(rawReviews) as unknown;
    if (!Array.isArray(comments) || !Array.isArray(reviews)) return null;
    const out: PrReviewItem[] = [];
    for (const item of comments) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'number' || typeof row.body !== 'string') continue;
      const user = (row.user ?? {}) as Record<string, unknown>;
      out.push({
        id: `c${row.id}`,
        author: typeof user.login === 'string' ? user.login : 'unknown',
        authorType: toAuthorType(user.type),
        body: row.body,
        ...(typeof row.html_url === 'string' ? { htmlUrl: row.html_url } : {}),
        ...(typeof row.created_at === 'string' ? { submittedAt: row.created_at } : {}),
      });
    }
    for (const item of reviews) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'number' || typeof row.body !== 'string') continue;
      if (row.body.trim().length === 0) continue; // approve 的 review 常是空 body
      const user = (row.user ?? {}) as Record<string, unknown>;
      out.push({
        id: `r${row.id}`,
        author: typeof user.login === 'string' ? user.login : 'unknown',
        authorType: toAuthorType(user.type),
        body: row.body,
        ...(typeof row.html_url === 'string' ? { htmlUrl: row.html_url } : {}),
        ...(typeof row.submitted_at === 'string' ? { submittedAt: row.submitted_at } : {}),
      });
    }
    return out;
  } catch {
    return null;
  }
}

export function selectUnseenPrReviews(
  items: readonly PrReviewItem[],
  seenIds: readonly string[],
): PrReviewItem[] {
  const seen = new Set(seenIds);
  return items.filter((item) => !seen.has(item.id));
}

export function formatPrReviewNote(input: {
  author: string;
  body: string;
  number: number;
  url: string;
}): string {
  return `💬 PR #${input.number} 来了新评论(${input.author}):${input.body} ${input.url}`;
}

export function formatPrReviewWakeTask(input: {
  comments: readonly PrReviewItem[];
  number: number;
  url: string;
}): string {
  const lines = input.comments.map((c) => `- ${c.author}:${c.body}`);
  return `PR #${input.number}(${input.url})来了 ${input.comments.length} 条新评论,请逐条处理:\n${lines.join('\n')}`;
}

export function createFixedPrReviewList(kind: 'user' | 'bot'): PrReviewList {
  return async () => ({
    ok: true,
    items: [
      {
        id: 'c9001',
        author: kind === 'user' ? 'reviewer-hr' : 'codecov-bot',
        authorType: kind === 'user' ? 'User' : 'Bot',
        body: '这里的边界条件没处理,除零要炸',
        htmlUrl: 'https://github.com/example/repo/pull/42#issuecomment-9001',
        submittedAt: '2026-09-05T00:00:00Z',
      },
    ],
  });
}

export type PrCheckConclusion = 'green' | 'red';

export interface PrCheckItem {
  id: string;
  name: string;
  conclusion: PrCheckConclusion;
  link?: string;
}

export interface PrCheckRef {
  item: PrCheckItem;
  prNumber: number;
  prUrl: string;
}

export type PrCheckListResult =
  | { ok: true; items: PrCheckItem[] }
  | { ok: false; reason: string };

export type PrCheckList = (input: { workdir: string; number: number }) => Promise<PrCheckListResult>;

const RED_STATES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED']);

export function parsePrChecksJson(raw: string): PrCheckItem[] | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    const out: PrCheckItem[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.name !== 'string' || typeof row.state !== 'string') continue;
      const state = row.state.toUpperCase();
      let conclusion: PrCheckConclusion | null = null;
      if (state === 'SUCCESS' || state === 'PASS' || state === 'SKIPPED') conclusion = 'green';
      else if (RED_STATES.has(state)) conclusion = 'red';
      if (!conclusion) continue;
      out.push({
        id: `${row.name}:${state}`,
        name: row.name,
        conclusion,
        ...(typeof row.link === 'string' ? { link: row.link } : {}),
      });
    }
    return out;
  } catch {
    return null;
  }
}

export function selectUnseenPrChecks(
  items: readonly PrCheckItem[],
  seenIds: readonly string[],
): PrCheckItem[] {
  const seen = new Set(seenIds);
  return items.filter((item) => !seen.has(item.id));
}

export function formatPrCiNote(input: {
  name: string;
  conclusion: PrCheckConclusion;
  number: number;
  url: string;
}): string {
  const tone = input.conclusion === 'green' ? 'CI 绿了' : 'CI 红了';
  return `${tone}(PR #${input.number} · ${input.name}) ${input.url}`;
}

export function formatPrCiWakeTask(input: {
  checks: readonly PrCheckItem[];
  number: number;
  url: string;
}): string {
  const lines = input.checks.map((c) => `- ${c.name}${c.link ? ` ${c.link}` : ''}`);
  return `PR #${input.number}(${input.url}) CI 红了,请修这些检查:\n${lines.join('\n')}`;
}

export function createFixedPrChecks(kind: 'green' | 'red'): PrCheckList {
  return async () => ({
    ok: true,
    items: [
      kind === 'green'
        ? { id: 'test:SUCCESS', name: 'test', conclusion: 'green' as const, link: 'https://ci.example/test' }
        : { id: 'lint:FAILURE', name: 'lint', conclusion: 'red' as const, link: 'https://ci.example/lint' },
    ],
  });
}

export async function listPrChecks(input: {
  workdir: string;
  number: number;
  ghBin?: string;
}): Promise<PrCheckListResult> {
  const bin = input.ghBin ?? 'gh';
  try {
    const { stdout } = await exec(
      bin,
      ['pr', 'checks', String(input.number), '--json', 'name,state,link'],
      { cwd: input.workdir, timeout: GH_TIMEOUT_MS },
    );
    const items = parsePrChecksJson(stdout);
    if (!items) return { ok: false, reason: '返回不是 JSON' };
    return { ok: true, items };
  } catch (err) {
    return { ok: false, reason: classifyPrLookupError(err) };
  }
}

export async function listPrReviews(input: { workdir: string; number: number; ghBin?: string }): Promise<PrReviewListResult> {
  const bin = input.ghBin ?? 'gh';
  try {
    const { stdout: nwo } = await exec(bin, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: input.workdir, timeout: GH_TIMEOUT_MS });
    const repo = nwo.trim();
    if (!repo) return { ok: false, reason: '拿不到仓库名' };
    const [{ stdout: rawComments }, { stdout: rawReviews }] = await Promise.all([
      exec(bin, ['api', `repos/${repo}/issues/${input.number}/comments`], { cwd: input.workdir, timeout: GH_TIMEOUT_MS }),
      exec(bin, ['api', `repos/${repo}/pulls/${input.number}/reviews`], { cwd: input.workdir, timeout: GH_TIMEOUT_MS }),
    ]);
    const items = parsePrReviewJson(rawComments, rawReviews);
    if (!items) return { ok: false, reason: '返回不是 JSON' };
    return { ok: true, items };
  } catch (err) {
    return { ok: false, reason: classifyPrLookupError(err) };
  }
}
