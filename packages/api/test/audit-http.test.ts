import { mkdtempSync, rmSync } from 'node:fs';
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

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-audit-http-'));
const threadA = `t-audit-http-a-${Date.now()}`;
const threadB = `t-audit-http-b-${Date.now()}`;

let baseUrl = '';
let server: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  const stores = createMemoryStores();
  await ensureSeededProfiles(stores.profiles);
  await stores.audit.append({
    threadId: threadA,
    actor: 'human',
    action: 'user-say',
    subject: '开口',
  });
  await stores.audit.append({
    threadId: threadA,
    actor: 'platform',
    action: 'relay',
    subject: '交棒',
  });
  await stores.audit.append({
    threadId: threadB,
    actor: 'human',
    action: 'user-say',
    subject: '另一线程',
  });
  server = await buildServer({
    stores,
    registry: createAgentRegistry([]),
    workdirBase,
    agents: DEFAULT_AGENTS,
    defaultAgentId: 'claude',
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(workdirBase, { recursive: true, force: true });
});

describe('GET /api/audit', () => {
  it('按 threadId / action 过滤,倒序', async () => {
    const byThread = await fetch(`${baseUrl}/api/audit?threadId=${threadA}`);
    expect(byThread.status).toBe(200);
    const threadRows = (await byThread.json()) as { action: string; threadId: string }[];
    expect(threadRows.map((r) => r.action)).toEqual(['relay', 'user-say']);
    expect(threadRows.every((r) => r.threadId === threadA)).toBe(true);

    const byAction = await fetch(`${baseUrl}/api/audit?threadId=${threadA}&action=relay`);
    const actionRows = (await byAction.json()) as { action: string }[];
    expect(actionRows.map((r) => r.action)).toEqual(['relay']);
  });

  it('limit 生效', async () => {
    const res = await fetch(`${baseUrl}/api/audit?threadId=${threadA}&limit=1`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { action: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('relay');
  });

  it('非法 limit 返回 400', async () => {
    for (const limit of ['0', '-1', '501', 'abc']) {
      const res = await fetch(`${baseUrl}/api/audit?limit=${limit}`);
      expect(res.status).toBe(400);
    }
  });
});

// buildServer 真的装了审计装饰器吗:上面那些用例是直接往 store 塞行,拆掉装饰器也不会红
describe('buildServer 装上了审计装饰器', () => {
  it('真发一条消息就有 user-say 和 hop-done', async () => {
    const stores = createMemoryStores();
    await ensureSeededProfiles(stores.profiles);
    const writer: AgentService = {
      agentId: 'claude',
      async runTurn() {
        return { sessionId: 's-audit', content: '好了。', status: 'completed' };
      },
    };
    const app = await buildServer({
      stores,
      registry: createAgentRegistry([writer]),
      workdirBase,
      agents: DEFAULT_AGENTS,
      defaultAgentId: 'claude',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const created = await fetch(`${url}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '记账', primaryAgentId: 'claude' }),
    });
    const { id: threadId } = (await created.json()) as { id: string };
    await fetch(`${url}/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '@claude 干活' }),
    });

    const rows = (await (await fetch(`${url}/api/audit?threadId=${threadId}`)).json()) as {
      action: string;
      actor: string;
    }[];
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('user-say');
    expect(actions).toContain('hop-done');
    expect(rows.find((r) => r.action === 'hop-done')?.actor).toBe('claude');
    await app.close();
  });
});
