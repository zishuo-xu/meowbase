import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRedisClient, assertStorageReady } from '../packages/api/src/redis.js';
import {
  E2E_REDIS_URL,
  FORBIDDEN_PORTS,
  REVIEWER_BIND_DELAY_MS,
  assertHappyChain,
  countAction,
  createThread,
  deleteThread,
  getAudit,
  getMessages,
  json,
  killHard,
  pickFreePortRetry,
  postMessage,
  runCrashResumePath,
  sleep,
  startApi,
  startApiExpectBindFail,
  waitFor,
} from './lib/harness.js';

const REDIS_URL = E2E_REDIS_URL;

async function runHappyPath(workdirBase: string): Promise<void> {
  const api = await startApi({ workdirBase, redisUrl: REDIS_URL });
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
  await runCrashResumePath({ workdirBase, redisUrl: REDIS_URL });
  console.log('✅ e2e crash-resume');
}

async function runBindConflictPath(workdirBase: string): Promise<void> {
  const port = await pickFreePortRetry();
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(`探测到的端口不能用: ${port}`);
  }
  const first = await startApi({
    workdirBase,
    redisUrl: REDIS_URL,
    port,
    reviewerDelayMs: REVIEWER_BIND_DELAY_MS,
  });
  const title = `e2e-bind-${Date.now()}`;
  let threadId = '';
  try {
    threadId = await createThread(first.baseUrl, title);
    await postMessage(first.baseUrl, threadId, '@墨墨 创建一个 hello.txt 文件');

    await waitFor('pendingHop 已被 #1 租走、审查官在跑', async () => {
      const threads = await json<Array<{ id: string; pendingHop?: { to?: string } }>>(
        await fetch(`${first.baseUrl}/api/threads`),
        'GET /threads',
      );
      const hopTo = threads.find((t) => t.id === threadId)?.pendingHop?.to;
      const rows = await getMessages(first.baseUrl, threadId);
      const running = rows.some(
        (m) => m.role === 'assistant' && m.agentId === 'gemini' && m.status === 'streaming',
      );
      const audit = await getAudit(first.baseUrl, threadId);
      const claimed = audit.some((r) => r.action === 'lease-claim');
      return hopTo === 'gemini' && running && claimed ? true : undefined;
    });

    const stealsBefore = countAction(await getAudit(first.baseUrl, threadId), 'lease-steal');

    const failed = await startApiExpectBindFail({
      workdirBase,
      redisUrl: REDIS_URL,
      port,
    });
    if (failed.code === 0) {
      throw new Error(`#2 退出码应为非 0,实际 0\n${failed.output}`);
    }
    if (!failed.output.includes('EADDRINUSE')) {
      throw new Error(`#2 stderr 应有 EADDRINUSE,退出码=${failed.code}\n${failed.output}`);
    }
    console.log(`   (预期) #2 撞 EADDRINUSE 起不来,退出码 ${failed.code}`);

    const stealsAfter = countAction(await getAudit(first.baseUrl, threadId), 'lease-steal');
    if (stealsAfter !== stealsBefore) {
      throw new Error(
        `lease-steal 从 ${stealsBefore} 增到 ${stealsAfter}:绑不上端口的进程不该抢租约`,
      );
    }

    await assertHappyChain(first.baseUrl, threadId);
    console.log('✅ e2e bind-conflict');
  } finally {
    if (threadId) await deleteThread(first.baseUrl, threadId);
    killHard(first.proc);
    await sleep(200);
  }
}

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-e2e-'));
const redis = createRedisClient(REDIS_URL);

try {
  await assertStorageReady(redis);
  await redis.flushdb();
  await runHappyPath(workdirBase);
  await runCrashPath(workdirBase);
  await runBindConflictPath(workdirBase);
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
