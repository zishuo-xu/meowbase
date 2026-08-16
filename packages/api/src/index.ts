import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
const repoRoot = resolve(import.meta.dirname, '../../../');

// skills 与 work 目录都相对仓库根解析(dev 时 cwd 是包目录)
const skillsDir = resolve(repoRoot, config.skillsDir);
const workdirBase = resolve(repoRoot, config.workdirBase);
mkdirSync(workdirBase, { recursive: true });

const redis = createRedisClient(config.redisUrl);
await assertStorageReady(redis);

const stores = {
  threads: createThreadStore(redis),
  messages: createMessageStore(redis),
  profiles: createProfileStore(redis),
  evidence: createEvidenceStore(redis),
  skills: createSkillStore(skillsDir),
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
  workdirBase,
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`meowbase api 已启动: http://localhost:${config.port}`);
