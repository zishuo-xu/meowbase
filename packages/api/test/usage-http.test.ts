import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { ensureSeededProfiles } from '../src/stores/seeds.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { buildServer } from '../src/http/server.js';
import { DEFAULT_AGENTS } from '../src/config.js';
import type { AppStores } from '../src/stores/ports.js';

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-usage-http-'));

let baseUrl = '';
let server: Awaited<ReturnType<typeof buildServer>>;
let stores: AppStores;
let threadA = '';
let threadB = '';

beforeAll(async () => {
  stores = createMemoryStores();
  await ensureSeededProfiles(stores.profiles);
  const a = await stores.threads.create({
    title: 'A',
    primaryAgentId: 'claude',
    workdirBase,
  });
  const b = await stores.threads.create({
    title: 'B',
    primaryAgentId: 'gemini',
    workdirBase,
  });
  threadA = a.id;
  threadB = b.id;
  await stores.messages.append({
    threadId: threadA,
    role: 'assistant',
    agentId: 'claude',
    content: 'ok',
    status: 'completed',
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, costUsd: 0.01 },
  });
  await stores.messages.append({
    threadId: threadA,
    role: 'assistant',
    agentId: 'claude',
    content: '半截',
    status: 'streaming',
    usage: { inputTokens: 999, costUsd: 9 },
  });
  await stores.messages.append({
    threadId: threadB,
    role: 'assistant',
    agentId: 'gemini',
    content: '审完',
    status: 'completed',
    usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
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

describe('GET /api/usage', () => {
  it('带 threadId 只算这条线程,返回 { byAgent, total }', async () => {
    const res = await fetch(`${baseUrl}/api/usage?threadId=${threadA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      byAgent: Record<string, { inputTokens?: number; costUsd?: number }>;
      total: { inputTokens?: number; costUsd?: number };
    };
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['byAgent', 'total']));
    expect(body.byAgent.claude?.inputTokens).toBe(10);
    expect(body.byAgent.claude?.costUsd).toBe(0.01);
    expect(body.byAgent.gemini).toBeUndefined();
    expect(body.total.inputTokens).toBe(10);
  });

  it('不带 threadId 跨线程合计', async () => {
    const res = await fetch(`${baseUrl}/api/usage`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      byAgent: Record<string, { inputTokens?: number }>;
      total: { inputTokens?: number };
    };
    expect(body.byAgent.claude?.inputTokens).toBe(10);
    expect(body.byAgent.gemini?.inputTokens).toBe(5);
    expect(body.total.inputTokens).toBe(15);
  });

  it('空库返回空 byAgent,不报错', async () => {
    const empty = createMemoryStores();
    const app = await buildServer({
      stores: empty,
      registry: createAgentRegistry([]),
      workdirBase,
      agents: DEFAULT_AGENTS,
      defaultAgentId: 'claude',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const res = await fetch(`${url}/api/usage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ byAgent: {}, total: {} });
    await app.close();
  });
});

describe('GET /api/usage/tools', () => {
  it('带 threadId 只算这条线程的技能和工具', async () => {
    await stores.messages.append({
      threadId: threadA,
      role: 'assistant',
      agentId: 'claude',
      content: '写了',
      status: 'completed',
      skillIds: ['review'],
      activities: [{ id: 't1', name: 'Write', status: 'done' }],
    });
    const res = await fetch(`${baseUrl}/api/usage/tools?threadId=${threadA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills: Array<{ id: string; count: number }>;
      tools: Array<{ name: string; category: string; count: number }>;
      total: { skillInjections: number; toolCalls: number };
    };
    expect(body.skills).toEqual([{ id: 'review', count: 1 }]);
    expect(body.tools).toEqual([{ name: 'Write', category: 'builtin', count: 1 }]);
    expect(body.total).toEqual({ skillInjections: 1, toolCalls: 1 });
  });
});
