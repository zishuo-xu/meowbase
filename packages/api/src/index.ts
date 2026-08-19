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
import { createAdapter } from './providers/factory.js';
import { createAgentRegistry } from './providers/registry.js';

const repoRoot = resolve(import.meta.dirname, '../../../');
const configPath = resolve(repoRoot, 'meowbase.config.json');
const config = loadConfig(process.env, { configPath });

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

const registry = createAgentRegistry(
  config.agents.map((spec) => createAdapter(spec, config.agentTimeoutMs)),
);

const app = await buildServer({
  stores,
  registry,
  workdirBase,
  a2aMaxDepth: config.a2aMaxDepth,
  defaultAgentId: config.defaultAgentId,
  agents: config.agents,
  models: config.models,
  configPath,
  rebuildAdapter: (spec) => registry.register(createAdapter(spec, config.agentTimeoutMs)),
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`meowbase api 已启动: http://localhost:${config.port}`);
// 绑上端口之后才捡搁着的棒:抢不到端口的进程不该去强抢别人的租约
app.startPendingRunner();
