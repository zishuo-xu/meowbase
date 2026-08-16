import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentId, AgentProfile } from '@meowbase/shared';
import { AGENT_IDS } from '@meowbase/shared';

export interface ModelPreset {
  id: string;
  label: string;
  bin: string;
  model: string;
}

export interface AgentSpec {
  id: AgentId;
  name: string;
  aliases: string[];
  role: string;
  personality: string;
  expertise: string[];
  bin: string;
  model?: string;
  /** 指向 models[] 里的条目;有则运行时用目录的 bin/model */
  modelId?: string;
}

export interface Config {
  port: number;
  redisUrl: string;
  workdirBase: string;
  agentTimeoutMs: number;
  skillsDir: string;
  a2aMaxDepth: number;
  defaultAgentId: AgentId;
  agents: AgentSpec[];
  models: ModelPreset[];
}

export const DEFAULT_A2A_MAX_DEPTH = 3;
const A2A_MAX_CAP = 10;

export const DEFAULT_MODELS: ModelPreset[] = [
  {
    id: 'flash',
    label: 'DeepSeek Flash',
    bin: 'opencode',
    model: 'opencode-go/deepseek-v4-flash',
  },
];

export const DEFAULT_AGENTS: AgentSpec[] = [
  {
    id: 'claude',
    name: '墨墨',
    aliases: ['墨墨', 'claude'],
    role: '主力写手',
    personality: '沉稳细致,爱写注释,重视代码可读性',
    expertise: ['架构设计', 'TypeScript', '代码实现'],
    bin: 'claude',
  },
  {
    id: 'gemini',
    name: '闪闪',
    aliases: ['闪闪', 'gemini'],
    role: '审查官',
    personality: '活泼,点子多,语速快',
    expertise: ['代码审查', '方案评审', '头脑风暴'],
    bin: 'gemini',
  },
  {
    id: 'opencode',
    name: '团团',
    aliases: ['团团', 'opencode'],
    role: '执行者',
    personality: '圆润可靠,话不多,执行力强',
    expertise: ['多模型兼容', '工具调用', '脚本'],
    bin: 'opencode',
    model: 'opencode-go/deepseek-v4-flash',
  },
];

interface TeamFile {
  a2a?: { maxDepth?: number };
  defaultAgentId?: string;
  models?: Array<Partial<ModelPreset> & { id: string }>;
  agents?: Array<Partial<AgentSpec> & { id: string }>;
}

function parseA2AMaxDepth(raw: string | number | undefined): number {
  const n = Number(raw ?? DEFAULT_A2A_MAX_DEPTH);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_A2A_MAX_DEPTH;
  return Math.min(Math.floor(n), A2A_MAX_CAP);
}

export function isAgentId(id: string): id is AgentId {
  return (AGENT_IDS as readonly string[]).includes(id);
}

export function cloneAgentSpec(spec: AgentSpec): AgentSpec {
  return { ...spec, aliases: [...spec.aliases], expertise: [...spec.expertise] };
}

export function cloneModelPreset(spec: ModelPreset): ModelPreset {
  return { ...spec };
}

export function slugModelId(model: string, bin: string): string {
  const raw = `${bin}-${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return raw || 'model';
}

export function parseModelCatalog(raw: unknown): ModelPreset[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ModelPreset[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null;
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const bin = typeof rec.bin === 'string' ? rec.bin.trim() : '';
    const model = typeof rec.model === 'string' ? rec.model.trim() : '';
    const label =
      typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : model;
    if (!id || !bin || !model) return null;
    if (seen.has(id)) return null;
    seen.add(id);
    out.push({ id, label, bin, model });
  }
  return out;
}

export function normalizeModelCatalog(
  fileModels: TeamFile['models'] | undefined,
  agents: AgentSpec[],
): ModelPreset[] {
  const parsed = parseModelCatalog(fileModels ?? []);
  const out: ModelPreset[] = [];
  const seen = new Set<string>();
  const add = (preset: ModelPreset) => {
    if (seen.has(preset.id)) return;
    seen.add(preset.id);
    out.push(cloneModelPreset(preset));
  };
  for (const preset of parsed ?? []) add(preset);
  if (out.length === 0) {
    for (const preset of DEFAULT_MODELS) add(preset);
  }
  for (const agent of agents) {
    if (!agent.model) continue;
    const hit = out.find((m) => m.model === agent.model && m.bin === agent.bin);
    if (!hit) {
      add({
        id: slugModelId(agent.model, agent.bin),
        label: agent.model,
        bin: agent.bin,
        model: agent.model,
      });
    }
  }
  return out;
}

export function syncAgentsWithCatalog(agents: AgentSpec[], models: ModelPreset[]): AgentSpec[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  return agents.map((spec) => {
    const next = cloneAgentSpec(spec);
    if (next.modelId) {
      const preset = byId.get(next.modelId);
      if (!preset) {
        delete next.modelId;
        return next;
      }
      next.bin = preset.bin;
      next.model = preset.model;
      return next;
    }
    const match = models.find((m) => m.model === next.model && m.bin === next.bin);
    if (match) next.modelId = match.id;
    return next;
  });
}

export interface AgentPatchInput {
  name?: string;
  aliases?: string[];
  role?: string;
  personality?: string;
  expertise?: string[];
  bin?: string;
  model?: string | null;
  modelId?: string | null;
}

export function applyAgentPatch(spec: AgentSpec, patch: AgentPatchInput): AgentSpec {
  const next = cloneAgentSpec(spec);
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (typeof patch.role === 'string' && patch.role.trim()) next.role = patch.role.trim();
  if (typeof patch.personality === 'string') next.personality = patch.personality.trim();
  if (typeof patch.bin === 'string' && patch.bin.trim()) next.bin = patch.bin.trim();
  if (Array.isArray(patch.aliases) && patch.aliases.length > 0) {
    next.aliases = patch.aliases.map((a) => a.replace(/^@/, '').trim()).filter(Boolean);
  }
  if (Array.isArray(patch.expertise)) {
    next.expertise = patch.expertise.map((e) => e.trim()).filter(Boolean);
  }
  if (patch.model === null || patch.model === '') {
    delete next.model;
  } else if (typeof patch.model === 'string' && patch.model.trim()) {
    next.model = patch.model.trim();
  }
  if (patch.modelId === null || patch.modelId === '') {
    delete next.modelId;
  } else if (typeof patch.modelId === 'string' && patch.modelId.trim()) {
    next.modelId = patch.modelId.trim();
  }
  return next;
}

export function applySharedModel(
  agents: AgentSpec[],
  input: { model: string; agentIds: AgentId[]; bin?: string },
): AgentSpec[] {
  const targets = new Set(input.agentIds);
  return agents.map((spec) => {
    if (!targets.has(spec.id)) return cloneAgentSpec(spec);
    return applyAgentPatch(spec, {
      model: input.model,
      ...(input.bin ? { bin: input.bin } : {}),
    });
  });
}

export function writeTeamFile(
  configPath: string,
  input: {
    a2aMaxDepth: number;
    defaultAgentId: AgentId;
    agents: AgentSpec[];
    models?: ModelPreset[];
  },
): void {
  const payload: TeamFile = {
    a2a: { maxDepth: input.a2aMaxDepth },
    defaultAgentId: input.defaultAgentId,
    models: (input.models ?? []).map(cloneModelPreset),
    agents: input.agents.map((a) => ({
      id: a.id,
      name: a.name,
      aliases: a.aliases,
      role: a.role,
      personality: a.personality,
      expertise: a.expertise,
      bin: a.bin,
      ...(a.model ? { model: a.model } : {}),
      ...(a.modelId ? { modelId: a.modelId } : {}),
    })),
  };
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function mergeAgents(overrides: TeamFile['agents']): AgentSpec[] {
  const byId = new Map<AgentId, AgentSpec>(DEFAULT_AGENTS.map((a) => [a.id, { ...a, aliases: [...a.aliases], expertise: [...a.expertise] }]));
  for (const row of overrides ?? []) {
    if (!isAgentId(row.id)) continue;
    const current = byId.get(row.id);
    if (!current) continue;
    byId.set(row.id, {
      ...current,
      ...('name' in row && row.name ? { name: row.name } : {}),
      ...('role' in row && row.role ? { role: row.role } : {}),
      ...('personality' in row && row.personality ? { personality: row.personality } : {}),
      ...('bin' in row && row.bin ? { bin: row.bin } : {}),
      ...('model' in row ? { model: row.model || undefined } : {}),
      ...('modelId' in row ? { modelId: row.modelId || undefined } : {}),
      ...(row.aliases && row.aliases.length > 0 ? { aliases: row.aliases.map((a) => a.replace(/^@/, '')) } : {}),
      ...(row.expertise && row.expertise.length > 0 ? { expertise: row.expertise } : {}),
    });
  }
  return AGENT_IDS.map((id) => byId.get(id)!);
}

function readTeamFile(configPath: string | undefined): TeamFile {
  if (!configPath || !existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as TeamFile;
  } catch {
    return {};
  }
}

export function agentSpec(config: Config, id: AgentId): AgentSpec {
  return config.agents.find((a) => a.id === id) ?? DEFAULT_AGENTS.find((a) => a.id === id)!;
}

export function profilesFromAgents(agents: AgentSpec[]): Omit<AgentProfile, 'createdAt'>[] {
  return agents.map((a) => ({
    agentId: a.id,
    name: a.name,
    personality: a.personality,
    role: a.role,
    expertise: a.expertise,
  }));
}

export interface PublicAgentConfig {
  id: AgentId;
  name: string;
  role: string;
  aliases: string[];
  bin: string;
  personality: string;
  expertise: string[];
  model?: string;
  modelId?: string;
  autoApprove?: boolean;
}

export function publicAgentConfig(
  spec: AgentSpec,
  extras?: { autoApprove?: boolean },
): PublicAgentConfig {
  return {
    id: spec.id,
    name: spec.name,
    role: spec.role,
    aliases: spec.aliases,
    bin: spec.bin,
    personality: spec.personality,
    expertise: spec.expertise,
    ...(spec.model ? { model: spec.model } : {}),
    ...(spec.modelId ? { modelId: spec.modelId } : {}),
    ...(typeof extras?.autoApprove === 'boolean' ? { autoApprove: extras.autoApprove } : {}),
  };
}

/** env 覆盖文件;文件只在显式传入 configPath 时读取(测试默认不碰仓库根文件) */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: { configPath?: string } = {},
): Config {
  const file = readTeamFile(opts.configPath);
  const agents = mergeAgents(file.agents);
  const models = normalizeModelCatalog(file.models, agents);
  const bound = syncAgentsWithCatalog(agents, models);

  const envBin: Record<AgentId, string | undefined> = {
    claude: env.CLAUDE_BIN,
    gemini: env.GEMINI_BIN,
    opencode: env.OPENCODE_BIN,
  };
  const envModel: Record<AgentId, string | undefined> = {
    claude: env.CLAUDE_MODEL,
    gemini: env.GEMINI_MODEL,
    opencode: env.OPENCODE_MODEL,
  };
  for (const spec of bound) {
    const bin = envBin[spec.id];
    if (bin) spec.bin = bin;
    const model = envModel[spec.id];
    if (model) spec.model = model;
  }

  const defaultAgentId =
    (file.defaultAgentId && isAgentId(file.defaultAgentId) && file.defaultAgentId) || 'claude';

  return {
    port: Number(env.PORT ?? 3200),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    workdirBase: env.WORKDIR_BASE ?? './work',
    agentTimeoutMs: Number(env.AGENT_TIMEOUT_MS ?? 300_000),
    skillsDir: env.SKILLS_DIR ?? './skills',
    a2aMaxDepth: parseA2AMaxDepth(env.A2A_MAX_DEPTH ?? file.a2a?.maxDepth),
    defaultAgentId,
    agents: bound,
    models,
  };
}
