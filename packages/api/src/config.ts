import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentId, AgentProfile } from '@meowbase/shared';
import { AGENT_IDS } from '@meowbase/shared';

export const MODEL_PROTOCOLS = ['anthropic', 'openai', 'gemini'] as const;
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];

export const CLIS_FOR_PROTOCOL: Record<ModelProtocol, readonly string[]> = {
  anthropic: ['claude', 'opencode'],
  openai: ['opencode'],
  gemini: ['gemini', 'opencode'],
};

export const DEFAULT_CLI_FOR_PROTOCOL: Record<ModelProtocol, string> = {
  anthropic: 'claude',
  openai: 'opencode',
  gemini: 'gemini',
};

export interface ModelPreset {
  id: string;
  label: string;
  /** 兼容旧配置与探测默认值,等于 bins[0] */
  bin: string;
  /** 能跑这条模型的 CLI,对齐 clowder:模型与 client 解耦 */
  bins: string[];
  /** 上游 HTTP 协议;决定哪些 CLI 能勾 */
  protocol: ModelProtocol;
  model: string;
  /** 可选网关地址;spawn 时按协议注入 ANTHROPIC_BASE_URL / OPENAI_BASE_URL 等 */
  baseUrl?: string;
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
  protocol?: ModelProtocol;
  baseUrl?: string;
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
    bins: ['opencode'],
    protocol: 'openai',
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
  return { ...spec, bins: [...spec.bins] };
}

export function uniqueBins(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const bin = item.trim();
    if (!bin || seen.has(bin)) continue;
    seen.add(bin);
    out.push(bin);
  }
  return out;
}

export function modelBins(preset: { bin?: string; bins?: string[] }): string[] {
  const fromBins = uniqueBins(preset.bins);
  if (fromBins.length > 0) return fromBins;
  return uniqueBins(preset.bin);
}

export function isKnownCliName(bin: string): boolean {
  return bin === 'claude' || bin === 'gemini' || bin === 'opencode';
}

export function parseModelProtocol(raw: unknown): ModelProtocol | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'anthropic' || value === 'anthropic-messages' || value === 'claude') return 'anthropic';
  if (value === 'openai' || value === 'openai-completions' || value === 'openai-responses') return 'openai';
  if (value === 'gemini' || value === 'google' || value === 'google-generative-ai') return 'gemini';
  return undefined;
}

export function inferModelProtocol(bins: string[], explicit?: unknown): ModelProtocol {
  return parseModelProtocol(explicit) ?? (bins.includes('claude') ? 'anthropic' : bins.includes('gemini') ? 'gemini' : 'openai');
}

export function compatibleBins(protocol: ModelProtocol, bins: string[]): string[] {
  const allowed = new Set<string>(CLIS_FOR_PROTOCOL[protocol]);
  const filtered = bins.filter((bin) => !isKnownCliName(bin) || allowed.has(bin));
  return filtered.length > 0 ? filtered : [DEFAULT_CLI_FOR_PROTOCOL[protocol]];
}

export function parseBaseUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const url = raw.trim();
  return url || undefined;
}

export function withModelBins(input: {
  id: string;
  label: string;
  model: string;
  bin?: string;
  bins?: string[];
  protocol?: unknown;
  baseUrl?: unknown;
}): ModelPreset | null {
  const rawBins = modelBins(input);
  if (!input.id || !input.model) return null;
  const protocol = inferModelProtocol(rawBins, input.protocol);
  const bins = compatibleBins(protocol, rawBins.length > 0 ? rawBins : [DEFAULT_CLI_FOR_PROTOCOL[protocol]]);
  if (bins.length === 0) return null;
  const baseUrl = parseBaseUrl(input.baseUrl);
  return {
    id: input.id,
    label: input.label,
    model: input.model,
    bins,
    bin: bins[0]!,
    protocol,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function resolvePresetBin(
  preset: { bin?: string; bins?: string[] },
  currentBin?: string,
  requestedBin?: string,
): string {
  const bins = modelBins(preset);
  if (requestedBin && bins.includes(requestedBin)) return requestedBin;
  if (currentBin && bins.includes(currentBin)) return currentBin;
  return bins[0] ?? '';
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
    const model = typeof rec.model === 'string' ? rec.model.trim() : '';
    const label =
      typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : model;
    const preset = withModelBins({
      id,
      label,
      model,
      bin: typeof rec.bin === 'string' ? rec.bin : undefined,
      bins: Array.isArray(rec.bins) ? (rec.bins as string[]) : undefined,
      protocol: rec.protocol,
      baseUrl: rec.baseUrl,
    });
    if (!preset) return null;
    if (seen.has(preset.id)) return null;
    seen.add(preset.id);
    out.push(preset);
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
    const hit = out.find((m) => m.model === agent.model && modelBins(m).includes(agent.bin));
    if (!hit) {
      const derived = withModelBins({
        id: slugModelId(agent.model, agent.bin),
        label: agent.model,
        bin: agent.bin,
        bins: [agent.bin],
        model: agent.model,
      });
      if (derived) add(derived);
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
      next.model = preset.model;
      next.bin = resolvePresetBin(preset, next.bin);
      next.protocol = preset.protocol;
      if (preset.baseUrl) next.baseUrl = preset.baseUrl;
      else delete next.baseUrl;
      return next;
    }
    const match = models.find(
      (m) => m.model === next.model && modelBins(m).includes(next.bin),
    );
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
  protocol?: ModelProtocol | null;
  baseUrl?: string | null;
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
  if (patch.protocol === null) {
    delete next.protocol;
  } else if (patch.protocol) {
    next.protocol = patch.protocol;
  }
  if (patch.baseUrl === null || patch.baseUrl === '') {
    delete next.baseUrl;
  } else if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim()) {
    next.baseUrl = patch.baseUrl.trim();
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
      ...(a.protocol ? { protocol: a.protocol } : {}),
      ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}),
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
      ...(parseModelProtocol(row.protocol) ? { protocol: parseModelProtocol(row.protocol) } : {}),
      ...('baseUrl' in row ? { baseUrl: row.baseUrl || undefined } : {}),
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
  protocol?: ModelProtocol;
  baseUrl?: string;
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
    ...(spec.protocol ? { protocol: spec.protocol } : {}),
    ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
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
