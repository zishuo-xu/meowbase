import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRedisClient, assertStorageReady } from '../packages/api/src/redis.js';
import {
  FORBIDDEN_PORTS,
  WEB_E2E_REDIS_URL,
  killHard,
  root,
  sleep,
  startApi,
  waitFor,
} from './lib/harness.js';

/** 烤进 web build 的 API 口。撞了就退出,不静默换。 */
export const WEB_E2E_API_PORT = 3212;
export const WEB_E2E_WEB_PORT = 3312;
const NEXT_DIST_DIR = '.next-e2e';
const REDIS_URL = WEB_E2E_REDIS_URL;
const opencodeBin = resolve(root, 'scripts/fixtures/fake-opencode-writer.mjs');

function assertPortFree(port: number): Promise<void> {
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(`端口 ${port} 是本地开发口,e2e:web 不许用`);
  }
  return new Promise((resolveFree, reject) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `e2e:web 端口 ${port} 已被占用,拒绝换端口。请先释放后再跑 pnpm e2e:web`,
          ),
        );
        return;
      }
      reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolveFree();
      });
    });
  });
}

function buildWeb(apiPort: number): void {
  execFileSync('pnpm', ['--filter', '@meowbase/web', 'build'], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
      NEXT_DIST_DIR,
    },
    stdio: 'inherit',
  });
  // next build 会把 next-env.d.ts 指到 .next-e2e,拨回默认 .next,免得日常 build 和工作区来回脏
  const nextEnvPath = resolve(root, 'packages/web/next-env.d.ts');
  const nextEnv = readFileSync(nextEnvPath, 'utf8').replace(
    './.next-e2e/types/routes.d.ts',
    './.next/types/routes.d.ts',
  );
  writeFileSync(nextEnvPath, nextEnv);
}

function startWeb(port: number): Promise<{ proc: ChildProcess; baseUrl: string }> {
  const proc = spawn(
    'pnpm',
    ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    {
      cwd: resolve(root, 'packages/web'),
      env: { ...process.env, NEXT_DIST_DIR, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  proc.stdout?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  proc.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  return waitFor(`web 在 ${port} 就绪`, async () => {
    if (proc.exitCode != null) {
      throw new Error(`next start 提前退出 code=${proc.exitCode}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      return res.ok ? { proc, baseUrl: `http://127.0.0.1:${port}` } : undefined;
    } catch {
      return undefined;
    }
  }, 45_000);
}

function runPlaywright(webUrl: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_WEB_URL: webUrl };
  // Cursor 沙箱会把 PLAYWRIGHT_BROWSERS_PATH 指到空缓存,装了的 chromium 也找不到。
  // 装不上该红,但已装在默认目录的必须能用。
  delete env.PLAYWRIGHT_BROWSERS_PATH;
  execFileSync('pnpm', ['exec', 'playwright', 'test'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
}

await assertPortFree(WEB_E2E_API_PORT);
await assertPortFree(WEB_E2E_WEB_PORT);

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-e2e-web-'));
const redis = createRedisClient(REDIS_URL);

try {
  await assertStorageReady(redis);
  await redis.flushdb();
  buildWeb(WEB_E2E_API_PORT);
  const api = await startApi({
    workdirBase,
    redisUrl: REDIS_URL,
    port: WEB_E2E_API_PORT,
    opencodeBin,
    extraEnv: {
      WEB_PORT: String(WEB_E2E_WEB_PORT),
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${WEB_E2E_API_PORT}`,
    },
  });
  let webProc: ChildProcess | undefined;
  try {
    const web = await startWeb(WEB_E2E_WEB_PORT);
    webProc = web.proc;
    runPlaywright(web.baseUrl);
    console.log('✅ e2e:web');
  } finally {
    if (webProc) killHard(webProc);
    killHard(api.proc);
    await sleep(200);
  }
} finally {
  try {
    await redis.flushdb();
  } catch {
    // 清理失败不掩盖用例结果
  }
  await redis.disconnect();
  rmSync(workdirBase, { recursive: true, force: true });
}
