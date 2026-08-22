import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { defaultAllowedRepoRoots, resolveListenHost } from '@meowbase/shared';
import { createMemoryStores } from '../src/stores/factories.js';
import { ensureSeededProfiles } from '../src/stores/seeds.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { buildServer } from '../src/http/server.js';
import { DEFAULT_AGENTS } from '../src/config.js';

const exec = promisify(execFile);

async function initScratchRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

async function startTestApi(opts?: {
  allowedRepoRoots?: readonly string[];
  allowedOrigins?: readonly string[];
}): Promise<{
  baseUrl: string;
  port: number;
  close: () => Promise<void>;
}> {
  const workdirBase = mkdtempSync(join(tmpdir(), 'meow-allow-work-'));
  const stores = createMemoryStores();
  await ensureSeededProfiles(stores.profiles);
  const app = await buildServer({
    stores,
    registry: createAgentRegistry([]),
    workdirBase,
    agents: DEFAULT_AGENTS,
    defaultAgentId: 'claude',
    ...(opts?.allowedRepoRoots ? { allowedRepoRoots: opts.allowedRepoRoots } : {}),
    ...(opts?.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: async () => {
      await app.close();
      rmSync(workdirBase, { recursive: true, force: true });
    },
  };
}

function tryWsUpgrade(port: number, origin?: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/ws?threadId=t-origin',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('1234567890123456').toString('base64'),
          ...(origin ? { Origin: origin } : {}),
        },
      },
      (res) => {
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve({ status: 101 });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('绑仓根白名单', () => {
  it('绑一个根外的 git 仓 → 403,selectedPath 是原话,带上 allowedRoots', async () => {
    const allowed = mkdtempSync(join(tmpdir(), 'meow-allow-in-'));
    const outside = mkdtempSync(join(tmpdir(), 'meow-allow-out-'));
    await initScratchRepo(outside);
    const typed = `${outside}/`;
    const api = await startTestApi({ allowedRepoRoots: [allowed] });
    try {
      const res = await fetch(`${api.baseUrl}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '根外', primaryAgentId: 'claude', repoPath: typed }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error: string;
        selectedPath: string;
        allowedRoots: string[];
      };
      expect(body.error).toMatch(/允许的根/);
      expect(body.selectedPath).toBe(typed);
      expect(body.allowedRoots.length).toBeGreaterThan(0);
      expect(body.allowedRoots.some((root) => outside.startsWith(root))).toBe(false);
    } finally {
      await api.close();
      rmSync(outside, { recursive: true, force: true });
      rmSync(allowed, { recursive: true, force: true });
    }
  });

  it('配了自定义根后家目录不再放行(覆盖不是追加)', async () => {
    const allowed = mkdtempSync(join(tmpdir(), 'meow-allow-only-'));
    const homePath = join(homedir(), 'meow-allow-home-probe');
    const api = await startTestApi({ allowedRepoRoots: [allowed] });
    try {
      const res = await fetch(`${api.baseUrl}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '家目录', primaryAgentId: 'claude', repoPath: homePath }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { selectedPath: string; allowedRoots: string[] };
      expect(body.selectedPath).toBe(homePath);
      expect(body.allowedRoots).not.toContain(defaultAllowedRepoRoots()[0]);
      expect(body.allowedRoots.some((root) => homePath.startsWith(root))).toBe(false);
    } finally {
      await api.close();
      rmSync(allowed, { recursive: true, force: true });
    }
  });

  it('默认根下放行 tmpdir 临时仓(eval 那两行靠这个)', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-eval-repo-'));
    await initScratchRepo(repo);
    const api = await startTestApi();
    try {
      const res = await fetch(`${api.baseUrl}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'tmpdir', primaryAgentId: 'claude', repoPath: repo }),
      });
      expect(res.status).toBe(201);
    } finally {
      await api.close();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('CORS / WS 来源表', () => {
  it('非法来源被拒,localhost 和 127.0.0.1 都放行', async () => {
    const api = await startTestApi();
    try {
      const evil = await fetch(`${api.baseUrl}/api/threads`, {
        method: 'GET',
        headers: { Origin: 'http://evil.example' },
      });
      expect(evil.status).toBe(403);
      expect(evil.headers.get('access-control-allow-origin')).not.toBe('http://evil.example');

      const local = await fetch(`${api.baseUrl}/api/threads`, {
        method: 'GET',
        headers: { Origin: 'http://localhost:3300' },
      });
      expect(local.status).toBe(200);
      expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:3300');

      const loopback = await fetch(`${api.baseUrl}/api/threads`, {
        method: 'GET',
        headers: { Origin: 'http://127.0.0.1:3300' },
      });
      expect(loopback.status).toBe(200);
      expect(loopback.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3300');
    } finally {
      await api.close();
    }
  });

  it('WS 带了不合法 Origin 被拒;不带 Origin 仍能连', async () => {
    const api = await startTestApi();
    try {
      const denied = await tryWsUpgrade(api.port, 'http://evil.example');
      expect(denied.status).toBe(403);

      const bare = await tryWsUpgrade(api.port);
      expect(bare.status).toBe(101);
    } finally {
      await api.close();
    }
  });
});

describe('API 监听地址', () => {
  it('默认 host 是 127.0.0.1,显式开关能改回 0.0.0.0', () => {
    expect(resolveListenHost({})).toBe('127.0.0.1');
    expect(resolveListenHost({ API_SERVER_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });
});
