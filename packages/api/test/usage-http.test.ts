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

describe('GET /api/usage/memory', () => {
  it('带 threadId 只算这条线程的证据注入和引用', async () => {
    await stores.messages.append({
      threadId: threadA,
      role: 'assistant',
      agentId: 'claude',
      content: '按 #ev_aaaaaaaa 做',
      status: 'completed',
      evidenceIds: ['ev_aaaaaaaa'],
    });
    const res = await fetch(`${baseUrl}/api/usage/memory?threadId=${threadA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; injections: number; citations: number }>;
      total: { injections: number; citations: number };
    };
    expect(body.items).toEqual([{ id: 'ev_aaaaaaaa', injections: 1, citations: 1 }]);
    expect(body.total).toEqual({ injections: 1, citations: 1 });
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

describe('GET /api/mcp/provision', () => {
  it('返回可粘贴的 mcpServers 片段', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/provision`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      command: string;
      claude: { mcpServers: { meowbase: { command: string; args: string[] } } };
      gemini: { allowedMcpServerNames: string[] };
      env: { MEOW_MCP_COMMAND: string; MEOW_API_URL: string };
    };
    expect(body.command.length).toBeGreaterThan(0);
    expect(body.claude.mcpServers.meowbase.command).toBe(body.command);
    expect(body.gemini.allowedMcpServerNames).toEqual(['meowbase']);
    expect(body.env.MEOW_API_URL).toContain('http');
  });
});

describe('GET /api/collab', () => {
  it('空 q 返回空数组;关键词命中摘录', async () => {
    await stores.messages.append({
      threadId: threadA,
      role: 'assistant',
      agentId: 'claude',
      content: '仓A斑马纹约定',
      status: 'completed',
    });
    const empty = await fetch(`${baseUrl}/api/collab/messages?q=`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
    const hit = await fetch(`${baseUrl}/api/collab/messages?q=${encodeURIComponent('斑马')}`);
    const body = (await hit.json()) as Array<{ excerpt: string; threadId: string }>;
    expect(body.some((row) => row.excerpt.includes('斑马纹') && row.threadId === threadA)).toBe(true);
    const threads = await fetch(`${baseUrl}/api/collab/threads`);
    const list = (await threads.json()) as Array<{ id: string; title: string }>;
    expect(list.some((row) => row.id === threadA)).toBe(true);
  });
});

describe('GET /api/hops/:hopId', () => {
  it('配了归档目录就能读回原始行', async () => {
    const { appendHopTranscript } = await import('../src/services/hop-transcript.js');
    const dir = mkdtempSync(join(tmpdir(), 'meow-hop-http-'));
    await appendHopTranscript(dir, threadA, 'hop-x', '{"type":"assistant"}');
    const app = await buildServer({
      stores,
      registry: createAgentRegistry([]),
      workdirBase,
      agents: DEFAULT_AGENTS,
      defaultAgentId: 'claude',
      hopTranscriptDir: dir,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const missing = await fetch(`${url}/api/hops/hop-x`);
    expect(missing.status).toBe(404);
    const res = await fetch(`${url}/api/hops/hop-x?threadId=${threadA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: Array<{ line: string }> };
    expect(body.lines.map((r) => r.line)).toEqual(['{"type":"assistant"}']);
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
