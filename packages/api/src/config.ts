export interface Config {
  port: number;
  redisUrl: string;
  claudeBin: string;
  workdirBase: string;
  agentTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3200),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    workdirBase: env.WORKDIR_BASE ?? './work',
    agentTimeoutMs: Number(env.AGENT_TIMEOUT_MS ?? 300_000),
  };
}
