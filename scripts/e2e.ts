import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRedisClient, assertStorageReady } from '../packages/api/src/redis.js';

const root = resolve(import.meta.dirname, '..');
const writerBin = resolve(root, 'scripts/fixtures/fake-claude-writer.mjs');
const reviewerBin = resolve(root, 'scripts/fixtures/fake-gemini-reviewer.mjs');
const serverPath = resolve(root, 'scripts/e2e-server.ts');

/** 独立 Redis DB,避免污染用户 3200 上的实例,也避免它来抢 e2e 的租约。 */
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/14';
const READY_RE = /E2E_API_READY (http:\/\/127\.0\.0\.1:\d+)/;
const START_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 30_000;
const REVIEWER_CRASH_DELAY_MS = 8_000;

interface ApiHandle {
  proc: ChildProcess;
  baseUrl: string;
}

interface MessageRow {
  id: string;
  role: string;
  agentId?: string;
  content: string;
  status: string;
  systemKind?: string;
  error?: string;
}

interface ApprovalRow {
  id: string;
  status: string;
  reviewComment?: string;
}

interface AuditRow {
  action: string;
}

interface UsageSummary {
  total?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killHard(proc: ChildProcess): void {
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

function startApi(opts: {
  workdirBase: string;
  reviewerDelayMs?: number;
}): Promise<ApiHandle> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: '0',
    REDIS_URL,
    WORKDIR_BASE: opts.workdirBase,
    SKILLS_DIR: resolve(root, 'skills'),
    CLAUDE_BIN: writerBin,
    GEMINI_BIN: reviewerBin,
    OPENCODE_BIN: writerBin,
    AGENT_TIMEOUT_MS: '30000',
    A2A_MAX_DEPTH: '3',
  };
  delete env.FAKE_DELAY_MS;
  delete env.FAKE_WRITER_DELAY_MS;
  delete env.FAKE_REVIEWER_DELAY_MS;
  if (opts.reviewerDelayMs && opts.reviewerDelayMs > 0) {
    env.FAKE_REVIEWER_DELAY_MS = String(opts.reviewerDelayMs);
  }

  const proc = spawn('tsx', [serverPath], {
    cwd: root,
    env,
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

async function json<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

async function createThread(baseUrl: string, title: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, primaryAgentId: 'claude' }),
  });
  const thread = await json<{ id: string }>(res, 'POST /api/threads');
  if (!thread.id) throw new Error('建线程未返回 id');
  return thread.id;
}

async function postMessage(baseUrl: string, threadId: string, content: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  await json<unknown>(res, 'POST /messages');
}

async function getMessages(baseUrl: string, threadId: string): Promise<MessageRow[]> {
  const res = await fetch(`${baseUrl}/api/threads/${threadId}/messages`);
  return json<MessageRow[]>(res, 'GET /messages');
}

async function getApprovals(baseUrl: string, threadId: string): Promise<ApprovalRow[]> {
  const res = await fetch(`${baseUrl}/api/approvals?threadId=${threadId}`);
  return json<ApprovalRow[]>(res, 'GET /approvals');
}

async function getAudit(baseUrl: string, threadId: string): Promise<AuditRow[]> {
  const res = await fetch(`${baseUrl}/api/audit?threadId=${threadId}&limit=200`);
  return json<AuditRow[]>(res, 'GET /audit');
}

async function getUsage(baseUrl: string, threadId: string): Promise<UsageSummary> {
  const res = await fetch(`${baseUrl}/api/usage?threadId=${threadId}`);
  return json<UsageSummary>(res, 'GET /usage');
}

async function deleteThread(baseUrl: string, threadId: string): Promise<void> {
  await fetch(`${baseUrl}/api/threads/${threadId}`, { method: 'DELETE' });
}

async function waitFor<T>(
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

function chronological(actions: string[]): string[] {
  return [...actions].reverse();
}

function assertSubsequence(actual: string[], expected: string[], label: string): void {
  let i = 0;
  for (const action of actual) {
    if (action === expected[i]) i += 1;
    if (i === expected.length) return;
  }
  throw new Error(
    `${label}: 审计缺动作序列 [${expected.join(' → ')}]\n实际(时间正序): ${actual.join(' → ')}`,
  );
}

async function assertHappyChain(baseUrl: string, threadId: string): Promise<void> {
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

async function runHappyPath(workdirBase: string): Promise<void> {
  const api = await startApi({ workdirBase });
  const title = `e2e-happy-${Date.now()}`;
  let threadId = '';
  try {
    threadId = await createThread(api.baseUrl, title);
    await postMessage(api.baseUrl, threadId, '@墨墨 创建一个 hello.txt 文件');
    await assertHappyChain(api.baseUrl, threadId);
    console.log('✅ e2e happy-path');
  } finally {
    if (threadId) await deleteThread(api.baseUrl, threadId);
    killHard(api.proc);
    await sleep(200);
  }
}

async function runCrashPath(workdirBase: string): Promise<void> {
  const first = await startApi({
    workdirBase,
    reviewerDelayMs: REVIEWER_CRASH_DELAY_MS,
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

    const second = await startApi({ workdirBase });
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
      console.log('✅ e2e crash-resume');
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

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-e2e-'));
const redis = createRedisClient(REDIS_URL);

try {
  await assertStorageReady(redis);
  await redis.flushdb();
  await runHappyPath(workdirBase);
  await runCrashPath(workdirBase);
  console.log('✅ e2e 全绿');
} finally {
  try {
    await redis.flushdb();
  } catch {
    // 清理失败不掩盖用例结果
  }
  await redis.disconnect();
  rmSync(workdirBase, { recursive: true, force: true });
}
