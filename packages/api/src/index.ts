import { mkdirSync } from 'node:fs';
import { buildServer } from './http/server.js';
import { loadConfig } from './config.js';
import { assertStorageReady, createRedisClient } from './redis.js';
import {
  createApprovalStore,
  createEvidenceStore,
  createMessageStore,
  createProfileStore,
  createSkillStore,
  createThreadStore,
} from './stores/factories.js';
import { ensureSeededProfiles } from './stores/seeds.js';
import { ClaudeAdapter } from './providers/claude.js';
import { OpenCodeAdapter } from './providers/opencode.js';
import { createAgentRegistry } from './providers/registry.js';

const config = loadConfig();
mkdirSync(config.workdirBase, { recursive: true });

const redis = createRedisClient(config.redisUrl);
await assertStorageReady(redis);

const stores = {
  threads: createThreadStore(redis),
  messages: createMessageStore(redis),
  profiles: createProfileStore(redis),
  evidence: createEvidenceStore(redis),
  skills: createSkillStore(config.skillsDir),
  approvals: createApprovalStore(redis),
};
await ensureSeededProfiles(stores.profiles);

const app = await buildServer({
  stores,
  registry: createAgentRegistry([
    new ClaudeAdapter({ bin: config.claudeBin, timeoutMs: config.agentTimeoutMs }),
    new OpenCodeAdapter({
      bin: config.opencodeBin,
      model: config.opencodeModel,
      timeoutMs: config.agentTimeoutMs,
    }),
  ]),
  workdirBase: config.workdirBase,
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`meowbase api 已启动: http://localhost:${config.port}`);
