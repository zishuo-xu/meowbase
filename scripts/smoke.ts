import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildServer } from '../packages/api/src/http/server.js';
import { loadConfig } from '../packages/api/src/config.js';
import { createRedisClient, assertStorageReady } from '../packages/api/src/redis.js';
import {
  createEvidenceStore,
  createMessageStore,
  createProfileStore,
  createSkillStore,
  createThreadStore,
} from '../packages/api/src/stores/factories.js';
import { ensureSeededProfiles } from '../packages/api/src/stores/seeds.js';
import { ClaudeAdapter } from '../packages/api/src/providers/claude.js';
import { createAgentRegistry } from '../packages/api/src/providers/registry.js';

const config = loadConfig();
const redis = createRedisClient(config.redisUrl);
await assertStorageReady(redis);

const stores = {
  threads: createThreadStore(redis),
  messages: createMessageStore(redis),
  profiles: createProfileStore(redis),
  evidence: createEvidenceStore(redis),
  skills: createSkillStore(join(process.cwd(), 'skills')),
};
await ensureSeededProfiles(stores.profiles);

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-smoke-'));
const app = await buildServer({
  stores,
  registry: createAgentRegistry([new ClaudeAdapter({ bin: config.claudeBin, timeoutMs: config.agentTimeoutMs })]),
  workdirBase,
});
await app.listen({ port: 0, host: '127.0.0.1' });
const address = app.server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const createRes = await fetch(`${baseUrl}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '冒烟', primaryAgentId: 'claude' }),
  });
  const thread = (await createRes.json()) as { id: string };

  console.log('线程已建,向 claude 发消息(真实执行,可能需 1-2 分钟)…');
  const msgRes = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '@claude 请用一句话介绍你自己\n#learn 冒烟测试结论' }),
  });
  const message = (await msgRes.json()) as {
    content: string;
    status: string;
    sessionId?: string;
    usage?: { inputTokens?: number; costUsd?: number };
  };

  console.log('status:', message.status);
  console.log('content:', message.content);
  console.log('sessionId:', message.sessionId);
  console.log('usage:', JSON.stringify(message.usage));

  if (message.status !== 'completed' || !message.content.trim()) {
    throw new Error(`冒烟失败: status=${message.status}`);
  }
  if (!message.sessionId) {
    throw new Error('冒烟失败: 未拿到 sessionId');
  }

  const evidenceRes = await fetch(`${baseUrl}/api/evidence?threadId=${thread.id}`);
  const evidence = (await evidenceRes.json()) as { title: string }[];
  console.log('evidence drafts:', evidence.length);
  if (evidence.length < 1) throw new Error('冒烟失败: 未生成证据 draft');
  console.log('✅ 冒烟通过');
} finally {
  await app.close();
  await redis.disconnect();
  rmSync(workdirBase, { recursive: true, force: true });
}
