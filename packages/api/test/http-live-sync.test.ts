import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { ensureSeededProfiles } from '../src/stores/seeds.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import { buildServer } from '../src/http/server.js';
import { DEFAULT_AGENTS } from '../src/config.js';

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-live-sync-'));

const writer: AgentService = {
  agentId: 'claude',
  async runTurn(input) {
    const handoff = /写个文件/.test(input.prompt);
    const text = handoff ? '写好了。\n@gemini 请审查' : '你好，我是 claude。';
    for (const ch of text) {
      input.onIncrement?.(ch);
    }
    if (handoff) {
      writeFileSync(join(input.workdir, 'hello.js'), 'export const n = 1\n');
    }
    return { sessionId: 's-writer', content: text, status: 'completed' };
  },
};

const reviewer: AgentService = {
  agentId: 'gemini',
  async runTurn() {
    await new Promise((r) => setTimeout(r, 80));
    return { sessionId: 's-reviewer', content: '## 结论\n通过', status: 'completed' };
  },
};

let baseUrl = '';
let server: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  const stores = createMemoryStores([
    { id: 'review', name: '代码审查', description: 'd', triggers: ['review'], prompt: '审查清单' },
  ]);
  await ensureSeededProfiles(stores.profiles);
  server = await buildServer({
    stores,
    registry: createAgentRegistry([writer, reviewer]),
    workdirBase,
    agents: DEFAULT_AGENTS,
    defaultAgentId: 'claude',
    a2aMaxDepth: 3,
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(workdirBase, { recursive: true, force: true });
});

type WsEvent = { type: string; threadId?: string; delta?: string };

async function createThread(title: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, primaryAgentId: 'claude' }),
  });
  const thread = (await res.json()) as { id: string };
  return thread.id;
}

async function openWs(threadId: string): Promise<{ ws: WebSocket; events: WsEvent[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(baseUrl).port}/api/ws?threadId=${threadId}`);
  const events: WsEvent[] = [];
  ws.onmessage = (event) => {
    events.push(JSON.parse(String(event.data)) as WsEvent);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });
  return { ws, events };
}

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('等待条件超时');
}

describe('HTTP live-sync', () => {
  it('POST 返回后背景接力仍推 sync,且审批卡已在', async () => {
    const threadId = await createThread('接力同步');
    const { ws, events } = await openWs(threadId);

    const pending = fetch(`${baseUrl}/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '@claude 写个文件' }),
    });
    const msgRes = await pending;
    expect(msgRes.status).toBe(200);
    const syncAtHttp = events.filter((e) => e.type === 'sync').length;
    const cardsAtHttp = (await (
      await fetch(`${baseUrl}/api/approvals?threadId=${threadId}`)
    ).json()) as unknown[];
    expect(cardsAtHttp).toHaveLength(0);

    await waitFor(async () => {
      const cards = (await (
        await fetch(`${baseUrl}/api/approvals?threadId=${threadId}`)
      ).json()) as unknown[];
      return cards.length > 0;
    });

    const syncAfter = events.filter((e) => e.type === 'sync');
    expect(syncAfter.length).toBeGreaterThan(syncAtHttp);
    expect(syncAfter.some((e) => e.threadId === threadId)).toBe(true);

    const cards = (await (
      await fetch(`${baseUrl}/api/approvals?threadId=${threadId}`)
    ).json()) as { reviewComment?: string }[];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.reviewComment).toContain('通过');
    ws.close();
  });

  it('系统命令路径也发 sync', async () => {
    const threadId = await createThread('拉闸同步');
    const { ws, events } = await openWs(threadId);

    const res = await fetch(`${baseUrl}/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '星星罐子' }),
    });
    expect(res.status).toBe(200);
    await waitFor(() => events.some((e) => e.type === 'sync'));
    expect(events.some((e) => e.type === 'sync' && e.threadId === threadId)).toBe(true);
    expect(events.some((e) => e.type === 'increment')).toBe(false);
    ws.close();
  });

  it('流式增量不按 token 发 sync', async () => {
    const threadId = await createThread('增量不同步');
    const { ws, events } = await openWs(threadId);

    await fetch(`${baseUrl}/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '@claude 打个招呼' }),
    });
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    const increments = events.filter((e) => e.type === 'increment');
    const syncs = events.filter((e) => e.type === 'sync');
    expect(increments.length).toBeGreaterThan(5);
    expect(syncs.length).toBeGreaterThan(0);
    expect(syncs.length).toBeLessThan(increments.length);
  });
});

describe('HTTP pending-runner 生命周期', () => {
  it('app.close 在开机扫和收尸 interval 下也能马上返回', async () => {
    const stores = createMemoryStores();
    await ensureSeededProfiles(stores.profiles);
    const app = await buildServer({
      stores,
      registry: createAgentRegistry([writer, reviewer]),
      workdirBase,
      agents: DEFAULT_AGENTS,
      defaultAgentId: 'claude',
      a2aMaxDepth: 3,
      hopSweepIntervalMs: 40,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    app.startPendingRunner();
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('绑不上端口的进程不捡棒,也不抢活着那个的租约', async () => {
    const stores = createMemoryStores();
    await ensureSeededProfiles(stores.profiles);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude', workdirBase });
    await stores.threads.setPendingHop(thread.id, {
      id: 'hop-live',
      to: 'gemini',
      from: 'claude',
      task: '请审查',
      goal: '写个文件',
      previousOutput: '写好了',
      visited: ['claude'],
      firstAgent: 'claude',
      hop: 1,
    });
    // 旧进程正握着租约、正在跑这一棒
    expect(await stores.threads.claimPendingHop(thread.id, 'live-runner', 60_000)).toBe(true);
    const deps = {
      stores,
      registry: createAgentRegistry([writer, reviewer]),
      workdirBase,
      agents: DEFAULT_AGENTS,
      defaultAgentId: 'claude' as const,
      a2aMaxDepth: 3,
      hopSweepIntervalMs: 20,
    };
    const live = await buildServer(deps);
    await live.listen({ port: 0, host: '127.0.0.1' });
    const port = (live.server.address() as AddressInfo).port;
    const loser = await buildServer(deps);
    await expect(loser.listen({ port, host: '127.0.0.1' })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 80));
    expect((await stores.threads.get(thread.id))?.pendingHop?.id).toBe('hop-live');
    expect(await stores.threads.renewPendingHopLease(thread.id, 'live-runner', 60_000)).toBe(true);
    await loser.close();
    await live.close();
  });
});
