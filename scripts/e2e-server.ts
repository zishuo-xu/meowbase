import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildServer } from '../packages/api/src/http/server.js';
import { loadConfig } from '../packages/api/src/config.js';
import { assertStorageReady, createRedisClient } from '../packages/api/src/redis.js';
import { createRedisStores } from '../packages/api/src/stores/factories.js';
import { ensureSeededProfiles } from '../packages/api/src/stores/seeds.js';
import { createAdapter } from '../packages/api/src/providers/factory.js';
import { createAgentRegistry } from '../packages/api/src/providers/registry.js';

const repoRoot = resolve(import.meta.dirname, '..');
// 不传 configPath:不读、不写仓库根 meowbase.config.json(那是用户本地运行时配置)
const config = loadConfig(process.env);
const skillsDir = resolve(repoRoot, config.skillsDir);
const workdirBase = resolve(config.workdirBase);
mkdirSync(workdirBase, { recursive: true });

const redis = createRedisClient(config.redisUrl);
await assertStorageReady(redis);

const stores = createRedisStores(redis, skillsDir);
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
});

const port = Number(process.env.PORT ?? 0);
await app.listen({ port, host: '127.0.0.1' });
const address = app.server.address() as AddressInfo;
const bound = address?.port ?? port;
console.log(`E2E_API_READY http://127.0.0.1:${bound}`);
// 绑上端口之后才捡搁着的棒:抢不到端口的进程不该去强抢别人的租约
app.startPendingRunner();
