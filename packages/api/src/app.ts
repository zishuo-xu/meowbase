import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './http/server.js';
import { loadConfig, type Config } from './config.js';
import { assertStorageReady, createRedisClient } from './redis.js';
import { createRedisStores } from './stores/factories.js';
import { ensureSeededProfiles } from './stores/seeds.js';
import { createAdapter } from './providers/factory.js';
import { createAgentRegistry } from './providers/registry.js';

export interface StartAppOptions {
  /** skillsDir / workdirBase 相对它解析;传入的绝对路径原样用 */
  repoRoot: string;
  /** 有则 loadConfig 读它、PATCH 回写;e2e 不传,绝不碰用户那份配置 */
  configPath?: string;
  host: string;
  /** 不传则用 config.port;e2e 传 `Number(process.env.PORT ?? 0)` */
  port?: number;
  /** 生产入口给 PATCH 名册后重建适配器;e2e 不需要 */
  rebuildAdapter?: boolean;
  /**
   * 有则用它当沙箱根,不读、不改 config 里的 workdirBase。
   * 不传才按 repoRoot + config.workdirBase 解析(e2e 走这条,WORKDIR_BASE 已是绝对路径)。
   */
  workdirBase?: string;
}

export interface StartedApp {
  app: FastifyInstance;
  config: Config;
  port: number;
  close: () => Promise<void>;
}

/**
 * 生产 / e2e / smoke 共用的启动接线。
 * `startPendingRunner()` 只在这里、且必须在 `listen` 成功之后——
 * 绑不上端口的进程不该去强抢别人的租约(onReady 在 EADDRINUSE 后照样会跑完)。
 */
export async function startApp(opts: StartAppOptions): Promise<StartedApp> {
  const config = loadConfig(process.env, opts.configPath ? { configPath: opts.configPath } : {});
  const skillsDir = resolve(opts.repoRoot, config.skillsDir);
  const workdirBase = opts.workdirBase ?? resolve(opts.repoRoot, config.workdirBase);
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
    holdCommands: config.holdCommands,
    holdCommandEnv: config.holdCommandEnv,
    ...(opts.configPath ? { configPath: opts.configPath } : {}),
    ...(opts.rebuildAdapter
      ? { rebuildAdapter: (spec) => registry.register(createAdapter(spec, config.agentTimeoutMs)) }
      : {}),
  });

  const listenPort = opts.port ?? config.port;
  try {
    await app.listen({ port: listenPort, host: opts.host });
  } catch (err) {
    // 绑不上就收摊退出:Redis 连接会把进程挂住,e2e 等不到非 0 退出码
    await app.close().catch(() => undefined);
    redis.disconnect();
    throw err;
  }
  const address = app.server.address() as AddressInfo | null;
  const bound = typeof address === 'object' && address ? address.port : listenPort;

  // 绑上端口之后才捡搁着的棒:抢不到端口的进程不该去强抢别人的租约
  await app.startPendingRunner();

  return {
    app,
    config,
    port: bound,
    close: async () => {
      await app.close();
      redis.disconnect();
    },
  };
}
