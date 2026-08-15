import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import { buildServer } from '../src/http/server.js';

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-test-'));

const fakeClaude: AgentService = {
  agentId: 'claude',
  async runTurn(input) {
    const parts = ['你好', ',我是', ' claude。'];
    for (const part of parts) {
      input.onIncrement?.(part);
    }
    return {
      sessionId: 'sess-http',
      content: parts.join(''),
      status: 'completed',
      usage: { inputTokens: 3, outputTokens: 5 },
    };
  },
};

let baseUrl = '';
let server: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  server = await buildServer({
    stores: createMemoryStores(),
    registry: createAgentRegistry([fakeClaude]),
    workdirBase,
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(workdirBase, { recursive: true, force: true });
});

describe('HTTP 集成', () => {
  it('创建线程 → 发消息 → 拿到完成结果', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '集成测试', primaryAgentId: 'claude' }),
    });
    expect(createRes.status).toBe(201);
    const thread = (await createRes.json()) as { id: string };

    const msgRes = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '@claude 写个 hello' }),
    });
    expect(msgRes.status).toBe(200);
    const message = (await msgRes.json()) as { content: string; status: string; usage?: { inputTokens?: number } };
    expect(message.content).toBe('你好,我是 claude。');
    expect(message.status).toBe('completed');
    expect(message.usage?.inputTokens).toBe(3);

    const listRes = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`);
    const messages = (await listRes.json()) as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('空 content 返回 400', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't' }),
    });
    const thread = (await createRes.json()) as { id: string };
    const res = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('WebSocket 收到流式增量', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ws' }),
    });
    const thread = (await createRes.json()) as { id: string };

    const ws = new WebSocket(`ws://127.0.0.1:${new URL(baseUrl).port}/api/ws?threadId=${thread.id}`);
    const received: string[] = [];
    ws.onmessage = (event) => {
      received.push((event.data as string).toString());
    };
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    const events = received.map((raw) => JSON.parse(raw) as { type: string; delta?: string });
    expect(events.filter((e) => e.type === 'increment').map((e) => e.delta).join('')).toBe(
      '你好,我是 claude。',
    );
  });
});
