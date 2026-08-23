import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '../..');
export const defaultWriterBin = resolve(root, 'scripts/fixtures/fake-claude-writer.mjs');
export const defaultReviewerBin = resolve(root, 'scripts/fixtures/fake-gemini-reviewer.mjs');
export const serverPath = resolve(root, 'scripts/e2e-server.ts');

export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/14';
export const EVAL_REDIS_URL = process.env.EVAL_REDIS_URL ?? 'redis://127.0.0.1:6379/13';

export const READY_RE = /E2E_API_READY (http:\/\/127\.0\.0\.1:\d+)/;
export const START_TIMEOUT_MS = 20_000;
export const POLL_TIMEOUT_MS = 30_000;
export const REVIEWER_CRASH_DELAY_MS = 8_000;
export const REVIEWER_BIND_DELAY_MS = 10_000;
export const FORBIDDEN_PORTS = new Set([3200, 3300]);

export interface ApiHandle {
  proc: ChildProcess;
  baseUrl: string;
}

export interface MessageRow {
  id: string;
  role: string;
  agentId?: string;
  content: string;
  status: string;
  systemKind?: string;
  systemMeta?: { from?: string; to?: string; verdict?: 'pass' | 'revise' | 'incomplete' };
  error?: string;
}

export interface ApprovalRow {
  id: string;
  status: string;
  reviewComment?: string;
  diffText?: string;
}

export interface ThreadRow {
  id: string;
  workdir: string;
  pendingHop?: { to?: string } | null;
}

export interface ScratchRepo {
  repoPath: string;
  baseBranch: string;
  remotePath?: string;
  cleanup: () => void;
}

export interface AuditRow {
  action: string;
  meta?: Record<string, unknown>;
}

export interface UsageSummary {
  total?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
}

export interface HarnessStartOpts {
  workdirBase: string;
  redisUrl: string;
  writerBin?: string;
  reviewerBin?: string;
  opencodeBin?: string;
  reviewerDelayMs?: number;
  writerDelayMs?: number;
  port?: number;
  extraEnv?: NodeJS.ProcessEnv;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function killHard(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // 已经没了
    }
  }
}

export function harnessEnv(opts: HarnessStartOpts): NodeJS.ProcessEnv {
  const writerBin = opts.writerBin ?? defaultWriterBin;
  const reviewerBin = opts.reviewerBin ?? defaultReviewerBin;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(opts.port ?? 0),
    REDIS_URL: opts.redisUrl,
    WORKDIR_BASE: opts.workdirBase,
    SKILLS_DIR: resolve(root, 'skills'),
    CLAUDE_BIN: writerBin,
    GEMINI_BIN: reviewerBin,
    OPENCODE_BIN: opts.opencodeBin ?? writerBin,
    AGENT_TIMEOUT_MS: '30000',
    A2A_MAX_DEPTH: '3',
  };
  delete env.FAKE_DELAY_MS;
  delete env.FAKE_WRITER_DELAY_MS;
  delete env.FAKE_REVIEWER_DELAY_MS;
  if (opts.reviewerDelayMs && opts.reviewerDelayMs > 0) {
    env.FAKE_REVIEWER_DELAY_MS = String(opts.reviewerDelayMs);
  }
  if (opts.writerDelayMs && opts.writerDelayMs > 0) {
    env.FAKE_WRITER_DELAY_MS = String(opts.writerDelayMs);
  }
  if (opts.extraEnv) Object.assign(env, opts.extraEnv);
  return env;
}

export function startApi(opts: HarnessStartOpts): Promise<ApiHandle> {
  const proc = spawn('tsx', [serverPath], {
    cwd: root,
    env: harnessEnv(opts),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  return new Promise<ApiHandle>((resolveReady, reject) => {
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killHard(proc);
      reject(new Error(`e2e-server 启动超时(${START_TIMEOUT_MS}ms)\n${buf}`));
    }, START_TIMEOUT_MS);

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      buf += text;
      process.stderr.write(text);
      const match = buf.match(READY_RE);
      if (!match?.[1] || settled) return;
      settled = true;
      clearTimeout(timer);
      resolveReady({ proc, baseUrl: match[1] });
    };
    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`e2e-server 提前退出 code=${code} signal=${signal}\n${buf}`));
    });
  });
}

export async function json<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

/** 临时真仓当绑仓目标。配本地 git 身份(CI 没有全局身份),分支名从仓库读,不写死 main/master。 */
export function makeScratchRepo(opts?: { withRemote?: boolean }): ScratchRepo {
  const repoPath = mkdtempSync(join(tmpdir(), 'meowbase-eval-repo-'));
  let remotePath: string | undefined;
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' });
  const cleanup = (): void => {
    rmSync(repoPath, { recursive: true, force: true });
    if (remotePath) rmSync(remotePath, { recursive: true, force: true });
  };
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'meowbase-eval']);
    git(['config', 'user.email', 'meowbase-eval@local']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repoPath, 'README.md'), 'eval scratch\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
    const baseBranch = git(['branch', '--show-current']).trim();
    if (!baseBranch) throw new Error('临时仓没有默认分支');
    if (opts?.withRemote) {
      remotePath = mkdtempSync(join(tmpdir(), 'meowbase-eval-bare-'));
      execFileSync('git', ['init', '--bare', '-q'], { cwd: remotePath });
      git(['remote', 'add', 'origin', remotePath]);
      git(['push', '-q', '-u', 'origin', baseBranch]);
    }
    return {
      repoPath,
      baseBranch,
      ...(remotePath ? { remotePath } : {}),
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export async function createThread(
  baseUrl: string,
  title: string,
  opts?: { repoPath?: string; baseBranch?: string },
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      primaryAgentId: 'claude',
      ...(opts?.repoPath ? { repoPath: opts.repoPath } : {}),
      ...(opts?.baseBranch ? { baseBranch: opts.baseBranch } : {}),
    }),
  });
  const thread = await json<{ id: string }>(res, 'POST /api/threads');
  if (!thread.id) throw new Error('建线程未返回 id');
  return thread.id;
}

export async function getThread(baseUrl: string, threadId: string): Promise<ThreadRow> {
  const res = await fetch(`${baseUrl}/api/threads`);
  const threads = await json<ThreadRow[]>(res, 'GET /api/threads');
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) throw new Error(`线程不存在: ${threadId}`);
  return thread;
}

export async function postMessage(baseUrl: string, threadId: string, content: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  await json<unknown>(res, 'POST /messages');
}

export async function getMessages(baseUrl: string, threadId: string): Promise<MessageRow[]> {
  const res = await fetch(`${baseUrl}/api/threads/${threadId}/messages`);
  return json<MessageRow[]>(res, 'GET /messages');
}

export async function getApprovals(baseUrl: string, threadId: string): Promise<ApprovalRow[]> {
  const res = await fetch(`${baseUrl}/api/approvals?threadId=${threadId}`);
  return json<ApprovalRow[]>(res, 'GET /approvals');
}

export async function getAudit(baseUrl: string, threadId: string): Promise<AuditRow[]> {
  const res = await fetch(`${baseUrl}/api/audit?threadId=${threadId}&limit=200`);
  return json<AuditRow[]>(res, 'GET /audit');
}

export async function getUsage(baseUrl: string, threadId: string): Promise<UsageSummary> {
  const res = await fetch(`${baseUrl}/api/usage?threadId=${threadId}`);
  return json<UsageSummary>(res, 'GET /usage');
}

export async function deleteThread(baseUrl: string, threadId: string): Promise<void> {
  await fetch(`${baseUrl}/api/threads/${threadId}`, { method: 'DELETE' });
}

export async function patchAutoApprove(
  baseUrl: string,
  agentId: string,
  autoApprove: boolean,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/profiles/${agentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ autoApprove }),
  });
  await json<unknown>(res, `PATCH /api/profiles/${agentId}`);
}

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | undefined>,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<T> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value !== undefined) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(150);
  }
  const extra = lastError instanceof Error ? `\n最后错误: ${lastError.message}` : '';
  throw new Error(`超时: ${label}${extra}`);
}

export function chronological(actions: string[]): string[] {
  return [...actions].reverse();
}

export function assertSubsequence(actual: string[], expected: string[], label: string): void {
  let i = 0;
  for (const action of actual) {
    if (action === expected[i]) i += 1;
    if (i === expected.length) return;
  }
  throw new Error(
    `${label}: 审计缺动作序列 [${expected.join(' → ')}]\n实际(时间正序): ${actual.join(' → ')}`,
  );
}

export function countAction(rows: AuditRow[], action: string): number {
  return rows.filter((r) => r.action === action).length;
}

export function pickFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else if (!port || FORBIDDEN_PORTS.has(port)) {
          reject(new Error(`探测到的端口不能用: ${port}`));
        } else resolvePort(port);
      });
    });
    server.on('error', reject);
  });
}

export async function pickFreePortRetry(tries = 5): Promise<number> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await pickFreePort();
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('拿不到空闲端口');
}

export function startApiExpectBindFail(
  opts: HarnessStartOpts & { port: number },
): Promise<{ code: number | null; output: string }> {
  const proc = spawn('tsx', [serverPath], {
    cwd: root,
    env: harnessEnv(opts),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  return new Promise((resolveFail, reject) => {
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killHard(proc);
      reject(new Error(`#2 该因 EADDRINUSE 退出,却还活着\n${buf}`));
    }, START_TIMEOUT_MS);

    // #2 的 EADDRINUSE 是本段期望的结果,不转发到父进程 stderr:
    // 绿色运行里躺一行 Error 会让人以为出事了。断言用的是 buf。
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      buf += text;
      if (!settled && READY_RE.test(buf)) {
        settled = true;
        clearTimeout(timer);
        killHard(proc);
        reject(new Error(`#2 不该绑上端口(固定端口被抢走?)\n${buf}`));
      }
    };
    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveFail({ code, output: buf || `signal=${signal}` });
    });
  });
}

export async function assertHappyChain(baseUrl: string, threadId: string): Promise<void> {
  const messages = await waitFor('接力链跑完(relay + 审批卡)', async () => {
    const rows = await getMessages(baseUrl, threadId);
    const relay = rows.some((m) => m.role === 'system' && m.systemKind === 'relay');
    const cards = await getApprovals(baseUrl, threadId);
    return relay && cards.length >= 1 ? rows : undefined;
  });

  const relay = messages.filter((m) => m.role === 'system' && m.systemKind === 'relay');
  if (relay.length < 1) throw new Error('没有 relay 系统消息');

  const cards = await getApprovals(baseUrl, threadId);
  if (cards.length !== 1) {
    throw new Error(`审批卡应正好 1 张,实际 ${cards.length}`);
  }
  if (!cards[0]?.reviewComment?.includes('通过')) {
    throw new Error(`审查意见没有「通过」: ${cards[0]?.reviewComment ?? '(空)'}`);
  }

  const audit = chronological((await getAudit(baseUrl, threadId)).map((r) => r.action));
  assertSubsequence(
    audit,
    ['user-say', 'hop-done', 'relay', 'hop-done', 'approval-created'],
    'happy-path',
  );

  const usage = await getUsage(baseUrl, threadId);
  const tokens =
    usage.total?.totalTokens ??
    (usage.total?.inputTokens ?? 0) + (usage.total?.outputTokens ?? 0);
  if (!tokens || tokens <= 0) {
    throw new Error(`账本没加出 token: ${JSON.stringify(usage)}`);
  }
}

/** 杀进程续跑:那一棒只重跑一遍,审批卡仍一张。e2e 与 eval 共用。 */
export async function runCrashResumePath(opts: {
  workdirBase: string;
  redisUrl: string;
  writerBin?: string;
  reviewerBin?: string;
  crashDelayMs?: number;
}): Promise<void> {
  const shared = {
    workdirBase: opts.workdirBase,
    redisUrl: opts.redisUrl,
    writerBin: opts.writerBin,
    reviewerBin: opts.reviewerBin,
  };
  const first = await startApi({
    ...shared,
    reviewerDelayMs: opts.crashDelayMs ?? REVIEWER_CRASH_DELAY_MS,
  });
  const title = `e2e-crash-${Date.now()}`;
  let threadId = '';
  try {
    threadId = await createThread(first.baseUrl, title);
    await postMessage(first.baseUrl, threadId, '@墨墨 创建一个 hello.txt 文件');
    await waitFor('审查官半截气泡(streaming)', async () => {
      const rows = await getMessages(first.baseUrl, threadId);
      return rows.find(
        (m) => m.role === 'assistant' && m.agentId === 'gemini' && m.status === 'streaming',
      );
    });
    killHard(first.proc);
    await sleep(300);

    const second = await startApi(shared);
    try {
      const messages = await waitFor('崩溃后续跑完(审批卡)', async () => {
        const cards = await getApprovals(second.baseUrl, threadId);
        return cards.length >= 1 ? getMessages(second.baseUrl, threadId) : undefined;
      });

      const failed = messages.filter(
        (m) => m.role === 'assistant' && m.agentId === 'gemini' && m.status === 'failed',
      );
      if (failed.length < 1) {
        throw new Error('半截助手气泡没有标成 failed');
      }
      if (!failed.some((m) => (m.error ?? '').includes('平台重启'))) {
        throw new Error(`failed 气泡没有「平台重启」: ${failed[0]?.error ?? '(空)'}`);
      }

      const completed = messages.filter(
        (m) => m.role === 'assistant' && m.agentId === 'gemini' && m.status === 'completed',
      );
      if (completed.length < 1) throw new Error('重跑后审查官没有 completed');

      const cards = await getApprovals(second.baseUrl, threadId);
      if (cards.length !== 1) {
        throw new Error(`崩溃后审批卡应仍然 1 张,实际 ${cards.length}`);
      }

      const audit = chronological((await getAudit(second.baseUrl, threadId)).map((r) => r.action));
      if (!audit.includes('hop-rerun')) {
        throw new Error(`审计没有 hop-rerun\n实际: ${audit.join(' → ')}`);
      }
      if (!audit.includes('lease-steal')) {
        throw new Error(`审计没有 lease-steal(开机没捡棒)\n实际: ${audit.join(' → ')}`);
      }
    } finally {
      if (threadId) await deleteThread(second.baseUrl, threadId);
      threadId = '';
      killHard(second.proc);
      await sleep(200);
    }
  } finally {
    killHard(first.proc);
    if (threadId) {
      // 第二段没建起来时,尽量用还活着的进程清;没有就留给 flushdb
    }
  }
}
