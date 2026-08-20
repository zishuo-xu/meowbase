import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentId, AgentProfile, HoldCommandRule } from '@meowbase/shared';
import {
  AGENT_IDS,
  DEFAULT_HOLD_COMMAND_ALLOWLIST,
  DEFAULT_ROSTER,
  parseHoldCommandAllowlist,
} from '@meowbase/shared';

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
  /** 可选;只进 meowbase.secrets.json,不进 git */
  apiKey?: string;
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
  apiKey?: string;
  /** 做完本职后交接给谁;平台选审查官也读这个 */
  handoffTo?: AgentId;
  /** 何时必须交接;`{to}` 替换成对手 @名 */
  handoff?: string[];
  /** 怎样算做完;`{to}` 替换成对手 @名 */
  doneWhen?: string[];
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
  /** 等跑白名单;配置可覆盖,默认用 shared 那张短表 */
  holdCommands: HoldCommandRule[];
  /** 子进程额外放行的环境变量名 */
  holdCommandEnv: string[];
}

export const DEFAULT_A2A_MAX_DEPTH = 3;
const A2A_MAX_CAP = 10;

export const DEFAULT_MODELS: ModelPreset[] = [
  {
    id: 'claude-sonnet',
    label: 'Claude Sonnet',
    bin: 'claude',
    bins: ['claude', 'opencode'],
    protocol: 'anthropic',
    model: 'sonnet',
  },
  {
    id: 'gemini-pro',
    label: 'Gemini Pro',
    bin: 'gemini',
    bins: ['gemini', 'opencode'],
    protocol: 'gemini',
    model: 'gemini-2.5-pro',
  },
  {
    id: 'flash',
    label: 'DeepSeek Flash',
    bin: 'opencode',
    bins: ['opencode'],
    protocol: 'openai',
    model: 'opencode-go/deepseek-v4-flash',
  },
];

function handoffFromRoster(id: AgentId): {
  handoffTo?: AgentId;
  handoff?: string[];
  doneWhen?: string[];
} {
  const row = DEFAULT_ROSTER.find((m) => m.agentId === id);
  return {
    ...(row?.handoffTo ? { handoffTo: row.handoffTo } : {}),
    ...(row?.handoff ? { handoff: [...row.handoff] } : {}),
    ...(row?.doneWhen ? { doneWhen: [...row.doneWhen] } : {}),
  };
}

export const DEFAULT_AGENTS: AgentSpec[] = [
  {
    id: 'claude',
    name: '墨墨',
    aliases: ['墨墨', 'claude'],
    role: '主架构师',
    personality: '沉稳细致,先想结构再动手,重视代码可读性',
    expertise: ['架构设计', 'TypeScript', '代码实现'],
    bin: 'claude',
    ...handoffFromRoster('claude'),
  },
  {
    id: 'gemini',
    name: '闪闪',
    aliases: ['闪闪', 'gemini'],
    role: '审查官',
    personality: '严谨直接,结论写明通过或需修改',
    expertise: ['代码审查', '质量把关'],
    bin: 'gemini',
    ...handoffFromRoster('gemini'),
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
    ...handoffFromRoster('opencode'),
  },
];

interface TeamFile {
  a2a?: { maxDepth?: number };
  defaultAgentId?: string;
  models?: Array<Partial<ModelPreset> & { id: string }>;
  agents?: Array<Partial<AgentSpec> & { id: string }>;
  holdCommands?: unknown;
  holdCommandEnv?: unknown;
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
  return {
    ...spec,
    aliases: [...spec.aliases],
    expertise: [...spec.expertise],
    ...(spec.handoff ? { handoff: [...spec.handoff] } : {}),
    ...(spec.doneWhen ? { doneWhen: [...spec.doneWhen] } : {}),
  };
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

export function parseApiKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim();
  return key || undefined;
}

export function withModelBins(input: {
  id: string;
  label: string;
  model: string;
  bin?: string;
  bins?: string[];
  protocol?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
}): ModelPreset | null {
  const rawBins = modelBins(input);
  if (!input.id || !input.model) return null;
  const protocol = inferModelProtocol(rawBins, input.protocol);
  const bins = compatibleBins(protocol, rawBins.length > 0 ? rawBins : [DEFAULT_CLI_FOR_PROTOCOL[protocol]]);
  if (bins.length === 0) return null;
  const baseUrl = parseBaseUrl(input.baseUrl);
  const apiKey = parseApiKey(input.apiKey);
  return {
    id: input.id,
    label: input.label,
    model: input.model,
    bins,
    bin: bins[0]!,
    protocol,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
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
      apiKey: rec.apiKey,
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
  if (!parsed || parsed.length === 0) {
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
      if (preset.apiKey) next.apiKey = preset.apiKey;
      else delete next.apiKey;
      return next;
    }
    const match = models.find(
      (m) => m.model === next.model && modelBins(m).includes(next.bin),
    );
    if (match) next.modelId = match.id;
    return next;
  });
}

/** Hub 用顿号拼接别名时,避免把「墨墨、claude」存成一个 token。 */
export function flattenNameList(
  items: readonly string[],
  opts: { stripAt?: boolean } = {},
): string[] {
  const stripAt = opts.stripAt !== false;
  const out: string[] = [];
  for (const item of items) {
    for (const part of item.split(/[,，、]+/)) {
      const token = (stripAt ? part.replace(/^@/, '') : part).trim();
      if (token && !out.includes(token)) out.push(token);
    }
  }
  return out;
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
  apiKey?: string | null;
}

export function applyAgentPatch(spec: AgentSpec, patch: AgentPatchInput): AgentSpec {
  const next = cloneAgentSpec(spec);
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (typeof patch.role === 'string' && patch.role.trim()) next.role = patch.role.trim();
  if (typeof patch.personality === 'string') next.personality = patch.personality.trim();
  if (typeof patch.bin === 'string' && patch.bin.trim()) next.bin = patch.bin.trim();
  if (Array.isArray(patch.aliases) && patch.aliases.length > 0) {
    next.aliases = flattenNameList(patch.aliases);
  }
  if (Array.isArray(patch.expertise)) {
    next.expertise = flattenNameList(patch.expertise, { stripAt: false });
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
  if (patch.apiKey === null || patch.apiKey === '') {
    delete next.apiKey;
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    next.apiKey = patch.apiKey.trim();
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
  const existing = readTeamFile(configPath);
  const payload: TeamFile = {
    a2a: { maxDepth: input.a2aMaxDepth },
    defaultAgentId: input.defaultAgentId,
    models: (input.models ?? []).map((preset) => {
      const row = cloneModelPreset(preset);
      delete row.apiKey;
      return row;
    }),
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
      ...(a.handoffTo ? { handoffTo: a.handoffTo } : {}),
      ...(a.handoff && a.handoff.length > 0 ? { handoff: a.handoff } : {}),
      ...(a.doneWhen && a.doneWhen.length > 0 ? { doneWhen: a.doneWhen } : {}),
    })),
    ...(existing.holdCommands !== undefined ? { holdCommands: existing.holdCommands } : {}),
    ...(existing.holdCommandEnv !== undefined ? { holdCommandEnv: existing.holdCommandEnv } : {}),
  };
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function secretsPathFor(configPath: string): string {
  return join(dirname(configPath), 'meowbase.secrets.json');
}

export function readModelSecrets(configPath: string | undefined): Record<string, string> {
  if (!configPath) return {};
  const path = secretsPathFor(configPath);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { modelApiKeys?: unknown };
    if (!raw.modelApiKeys || typeof raw.modelApiKeys !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw.modelApiKeys as Record<string, unknown>)) {
      const key = parseApiKey(value);
      if (key) out[id] = key;
    }
    return out;
  } catch {
    return {};
  }
}

export function applyModelSecrets(models: ModelPreset[], keys: Record<string, string>): ModelPreset[] {
  return models.map((preset) => {
    const apiKey = keys[preset.id];
    if (!apiKey) return cloneModelPreset(preset);
    return { ...cloneModelPreset(preset), apiKey };
  });
}

export function writeSecretsFile(configPath: string, models: ModelPreset[]): void {
  const modelApiKeys: Record<string, string> = {};
  for (const preset of models) {
    if (preset.apiKey) modelApiKeys[preset.id] = preset.apiKey;
  }
  const path = secretsPathFor(configPath);
  writeFileSync(path, `${JSON.stringify({ modelApiKeys }, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows 等可能不支持 chmod
  }
}

export function persistTeamConfig(
  configPath: string,
  input: {
    a2aMaxDepth: number;
    defaultAgentId: AgentId;
    agents: AgentSpec[];
    models?: ModelPreset[];
  },
): void {
  writeTeamFile(configPath, input);
  writeSecretsFile(configPath, input.models ?? []);
}

export function applyCatalogApiKeys(
  previous: ModelPreset[],
  parsed: ModelPreset[],
  raw: unknown,
): ModelPreset[] {
  const prevById = new Map(previous.map((preset) => [preset.id, preset]));
  const rows = Array.isArray(raw) ? raw : [];
  return parsed.map((preset, index) => {
    const next = cloneModelPreset(preset);
    const rec =
      rows[index] && typeof rows[index] === 'object' ? (rows[index] as Record<string, unknown>) : {};
    if ('apiKey' in rec) {
      const key = parseApiKey(rec.apiKey);
      if (key) next.apiKey = key;
      else delete next.apiKey;
      return next;
    }
    const old = prevById.get(preset.id);
    if (old?.apiKey) next.apiKey = old.apiKey;
    return next;
  });
}

export function publicModelPreset(
  preset: ModelPreset,
): Omit<ModelPreset, 'apiKey'> & { hasApiKey?: boolean } {
  const { apiKey, ...rest } = cloneModelPreset(preset);
  return { ...rest, ...(apiKey ? { hasApiKey: true } : {}) };
}

function mergeAgents(overrides: TeamFile['agents']): AgentSpec[] {
  const byId = new Map<AgentId, AgentSpec>(DEFAULT_AGENTS.map((a) => [a.id, cloneAgentSpec(a)]));
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
      ...('apiKey' in row ? { apiKey: row.apiKey || undefined } : {}),
      ...(row.aliases && row.aliases.length > 0 ? { aliases: flattenNameList(row.aliases) } : {}),
      ...(row.expertise && row.expertise.length > 0 ? { expertise: flattenNameList(row.expertise, { stripAt: false }) } : {}),
      ...(row.handoffTo && isAgentId(row.handoffTo) ? { handoffTo: row.handoffTo } : {}),
      ...(Array.isArray(row.handoff) && row.handoff.length > 0
        ? { handoff: row.handoff.map((line) => line.trim()).filter(Boolean) }
        : {}),
      ...(Array.isArray(row.doneWhen) && row.doneWhen.length > 0
        ? { doneWhen: row.doneWhen.map((line) => line.trim()).filter(Boolean) }
        : {}),
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
  const models = applyModelSecrets(
    normalizeModelCatalog(file.models, agents),
    readModelSecrets(opts.configPath),
  );
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
    holdCommands: parseHoldCommandAllowlist(file.holdCommands) ?? [...DEFAULT_HOLD_COMMAND_ALLOWLIST],
    holdCommandEnv: parseHoldCommandEnv(file.holdCommandEnv),
  };
}

function parseHoldCommandEnv(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}
