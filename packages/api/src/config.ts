export interface Config {
  port: number;
  redisUrl: string;
  claudeBin: string;
  geminiBin: string;
  geminiModel?: string;
  opencodeBin: string;
  opencodeModel: string;
  workdirBase: string;
  agentTimeoutMs: number;
  skillsDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3200),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    geminiBin: env.GEMINI_BIN ?? 'gemini',
    geminiModel: env.GEMINI_MODEL || undefined,
    opencodeBin: env.OPENCODE_BIN ?? 'opencode',
    opencodeModel: env.OPENCODE_MODEL ?? 'opencode-go/deepseek-v4-flash',
    workdirBase: env.WORKDIR_BASE ?? './work',
    agentTimeoutMs: Number(env.AGENT_TIMEOUT_MS ?? 300_000),
    skillsDir: env.SKILLS_DIR ?? './skills',
  };
}
