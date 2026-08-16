import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket, { type WebSocket } from '@fastify/websocket';
import type { AgentId } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from '../stores/ports.js';
import type { AgentPatchInput, AgentSpec, ModelPreset } from '../config.js';
import {
  applyAgentPatch,
  applySharedModel,
  cloneAgentSpec,
  cloneModelPreset,
  isAgentId,
  normalizeModelCatalog,
  parseApiKey,
  parseBaseUrl,
  parseModelCatalog,
  parseModelProtocol,
  persistTeamConfig,
  publicAgentConfig,
  publicModelPreset,
  applyCatalogApiKeys,
  resolvePresetBin,
  syncAgentsWithCatalog,
} from '../config.js';
import { executeTurn } from '../router/execute-turn.js';
import { gitInit } from '../services/git.js';
import { verifyModelConnection } from '../providers/verify-model.js';

export interface ApiDeps {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
    skills: SkillStore;
    approvals: ApprovalStore;
  };
  registry: AgentRegistry;
  workdirBase: string;
  a2aMaxDepth?: number;
  defaultAgentId?: AgentId;
  agents?: AgentSpec[];
  models?: ModelPreset[];
  /** 有则 PATCH 后写入该路径 */
  configPath?: string;
  persistConfig?: () => void;
  rebuildAdapter?: (spec: AgentSpec) => void;
}

interface LiveConfig {
  a2aMaxDepth: number;
  defaultAgentId: AgentId;
  agents: AgentSpec[];
  models: ModelPreset[];
}

function parsePatchDepth(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.floor(n);
}

function adapterRuntimeChanged(prev: AgentSpec, next: AgentSpec): boolean {
  return (
    prev.bin !== next.bin ||
    prev.model !== next.model ||
    prev.protocol !== next.protocol ||
    prev.baseUrl !== next.baseUrl ||
    prev.apiKey !== next.apiKey
  );
}

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const emitter = new EventEmitter();
  const live: LiveConfig = {
    a2aMaxDepth: deps.a2aMaxDepth ?? 3,
    defaultAgentId: deps.defaultAgentId ?? 'claude',
    agents: (deps.agents ?? []).map(cloneAgentSpec),
    models: (deps.models?.length
      ? deps.models
      : normalizeModelCatalog(undefined, deps.agents ?? [])
    ).map(cloneModelPreset),
  };
  live.agents = syncAgentsWithCatalog(live.agents, live.models);

  function persist() {
    if (deps.persistConfig) {
      deps.persistConfig();
      return;
    }
    if (deps.configPath) {
      persistTeamConfig(deps.configPath, live);
    }
  }

  async function publicConfig() {
    const profiles = await deps.stores.profiles.list();
    const autoById = new Map(profiles.map((p) => [p.agentId, p.autoApprove]));
    const agents =
      live.agents.length > 0
        ? live.agents.map((spec) => publicAgentConfig(spec, { autoApprove: autoById.get(spec.id) }))
        : profiles.map((p) => ({
            id: p.agentId,
            name: p.name,
            role: p.role,
            aliases: [p.name, p.agentId],
            bin: p.agentId,
            personality: p.personality,
            expertise: p.expertise,
            ...(typeof p.autoApprove === 'boolean' ? { autoApprove: p.autoApprove } : {}),
          }));
    return {
      a2aMaxDepth: live.a2aMaxDepth,
      defaultAgentId: live.defaultAgentId,
      models: live.models.map(publicModelPreset),
      agents,
    };
  }

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.post('/api/threads', async (request, reply) => {
    const body = request.body as { title?: string; primaryAgentId?: AgentId } | null;
    const thread = await deps.stores.threads.create({
      title: body?.title?.trim() || '新线程',
      primaryAgentId: body?.primaryAgentId ?? live.defaultAgentId,
      workdirBase: deps.workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    // 先写 package.json 再建基线:让 opencode 把沙箱目录识别为项目根,
    // 避免它上溯到仓库根导致文件写到沙箱外;且不污染 diff 基线
    writeFileSync(
      join(thread.workdir, 'package.json'),
      JSON.stringify({ name: 'meowbase-thread', private: true }, null, 2),
    );
    await gitInit(thread.workdir);
    return reply.code(201).send(thread);
  });

  app.get('/api/threads', async () => deps.stores.threads.list());

  app.get('/api/profiles', async () => deps.stores.profiles.list());

  app.get('/api/config', async () => publicConfig());

  app.post('/api/config/models/verify', async (request, reply) => {
    const body = request.body as {
      bin?: string;
      model?: string;
      modelId?: string;
      protocol?: string;
      baseUrl?: string;
      apiKey?: string;
    } | null;
    let bin = body?.bin?.trim() ?? '';
    let model = body?.model?.trim() ?? '';
    let protocol = parseModelProtocol(body?.protocol);
    let baseUrl = parseBaseUrl(body?.baseUrl);
    let apiKey = parseApiKey(body?.apiKey);
    if (body?.modelId?.trim()) {
      const preset = live.models.find((m) => m.id === body.modelId?.trim());
      if (!preset) return reply.code(404).send({ error: `模型目录没有: ${body.modelId}` });
      bin = bin || resolvePresetBin(preset, undefined, bin);
      model = model || preset.model;
      protocol = protocol ?? preset.protocol;
      baseUrl = baseUrl ?? preset.baseUrl;
      apiKey = apiKey ?? preset.apiKey;
    }
    if (!bin) return reply.code(400).send({ error: 'bin 不能为空' });
    return verifyModelConnection({ bin, model, protocol, baseUrl, apiKey, timeoutMs: 45_000 });
  });

  app.patch('/api/config', async (request, reply) => {
    const body = request.body as {
      a2aMaxDepth?: unknown;
      defaultAgentId?: unknown;
      models?: unknown;
      applyModel?: { model?: unknown; agentIds?: unknown; bin?: unknown };
    } | null;
    if (body?.a2aMaxDepth !== undefined) {
      const depth = parsePatchDepth(body.a2aMaxDepth);
      if (depth === null) return reply.code(400).send({ error: 'a2aMaxDepth 须为 1–10 的整数' });
      live.a2aMaxDepth = depth;
    }
    if (body?.defaultAgentId !== undefined) {
      if (typeof body.defaultAgentId !== 'string' || !isAgentId(body.defaultAgentId)) {
        return reply.code(400).send({ error: 'defaultAgentId 无效' });
      }
      live.defaultAgentId = body.defaultAgentId;
    }
    if (body?.models !== undefined) {
      const parsed = parseModelCatalog(body.models);
      if (!parsed) return reply.code(400).send({ error: 'models 须为 {id,label,bins,model} 数组且 id 不重复' });
      const prevAgents = live.agents.map(cloneAgentSpec);
      live.models = applyCatalogApiKeys(live.models, parsed, body.models);
      live.agents = syncAgentsWithCatalog(live.agents, live.models);
      for (const next of live.agents) {
        const prev = prevAgents.find((a) => a.id === next.id);
        if (prev && adapterRuntimeChanged(prev, next)) {
          deps.rebuildAdapter?.(next);
        }
      }
    }
    if (body?.applyModel) {
      const rawIds = body.applyModel.agentIds;
      const model = typeof body.applyModel.model === 'string' ? body.applyModel.model.trim() : '';
      if (!model) return reply.code(400).send({ error: 'applyModel.model 不能为空' });
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return reply.code(400).send({ error: 'applyModel.agentIds 不能为空' });
      }
      const agentIds = rawIds.filter((id): id is AgentId => typeof id === 'string' && isAgentId(id));
      if (agentIds.length !== rawIds.length) {
        return reply.code(400).send({ error: 'applyModel.agentIds 含未知 agent' });
      }
      const bin =
        typeof body.applyModel.bin === 'string' && body.applyModel.bin.trim()
          ? body.applyModel.bin.trim()
          : undefined;
      const prevById = new Map(live.agents.map((a) => [a.id, a]));
      live.agents = applySharedModel(live.agents, { model, agentIds, bin });
      for (const id of agentIds) {
        const prev = prevById.get(id);
        const next = live.agents.find((a) => a.id === id);
        if (next && prev && adapterRuntimeChanged(prev, next)) {
          deps.rebuildAdapter?.(next);
        }
      }
    }
    persist();
    return publicConfig();
  });

  app.patch('/api/config/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    if (!isAgentId(agentId)) return reply.code(404).send({ error: `agent 不存在: ${agentId}` });
    const index = live.agents.findIndex((a) => a.id === agentId);
    if (index < 0) return reply.code(404).send({ error: `agent 不存在: ${agentId}` });
    const body = (request.body ?? {}) as AgentPatchInput & { autoApprove?: unknown };
    if (typeof body.name === 'string' && !body.name.trim()) {
      return reply.code(400).send({ error: 'name 不能为空' });
    }
    if (typeof body.modelId === 'string' && body.modelId.trim()) {
      const modelId = body.modelId.trim();
      const preset = live.models.find((m) => m.id === modelId);
      if (!preset) return reply.code(400).send({ error: `模型目录没有: ${modelId}` });
      body.model = preset.model;
      body.bin = resolvePresetBin(
        preset,
        live.agents[index]?.bin,
        typeof body.bin === 'string' ? body.bin.trim() : undefined,
      );
      body.protocol = preset.protocol;
      body.baseUrl = preset.baseUrl ?? '';
      body.apiKey = preset.apiKey ?? '';
    }
    const prev = live.agents[index]!;
    const next = applyAgentPatch(prev, body);
    live.agents[index] = next;
    if (typeof body.autoApprove === 'boolean') {
      await deps.stores.profiles.updateAutoApprove(agentId, body.autoApprove);
    }
    if (adapterRuntimeChanged(prev, next)) {
      deps.rebuildAdapter?.(next);
    }
    persist();
    const profile = await deps.stores.profiles.get(agentId);
    return publicAgentConfig(next, { autoApprove: profile?.autoApprove });
  });

  app.patch('/api/profiles/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { autoApprove?: boolean } | null;
    if (typeof body?.autoApprove !== 'boolean') {
      return reply.code(400).send({ error: 'autoApprove 必须是布尔值' });
    }
    const updated = await deps.stores.profiles.updateAutoApprove(
      agentId as AgentId,
      body.autoApprove,
    );
    if (!updated) return reply.code(404).send({ error: `profile 不存在: ${agentId}` });
    return reply.code(200).send(updated);
  });

  app.get('/api/evidence', async (request) => {
    const { threadId } = request.query as { threadId?: string };
    return deps.stores.evidence.list(threadId);
  });

  app.get('/api/skills', async () => deps.stores.skills.list());

  app.get('/api/approvals', async (request) => {
    const { threadId } = request.query as { threadId?: string };
    return deps.stores.approvals.list(threadId);
  });

  app.get('/api/threads/:threadId/messages', async (request) => {
    const { threadId } = request.params as { threadId: string };
    return deps.stores.messages.list(threadId);
  });

  app.post('/api/threads/:threadId/messages', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = request.body as { content?: string } | null;
    const content = body?.content?.trim();
    if (!content) {
      return reply.code(400).send({ error: 'content 不能为空' });
    }
    const message = await executeTurn({
      threadId,
      content,
      context: {
        stores: deps.stores,
        registry: deps.registry,
        a2aMaxDepth: live.a2aMaxDepth,
        agents: live.agents.length > 0 ? live.agents : deps.agents,
        onIncrement: (tid, messageId, delta, agentId) => {
          emitter.emit(`increment:${tid}`, { messageId, delta, agentId });
        },
        onActivity: (tid, messageId, activity, agentId) => {
          emitter.emit(`activity:${tid}`, { messageId, activity, agentId });
        },
      },
    });
    return reply.code(200).send(message);
  });

  app.get('/api/ws', { websocket: true }, (socket: WebSocket, request) => {
    const { threadId } = request.query as { threadId?: string };
    if (!threadId) {
      socket.close();
      return;
    }
    const onIncrement = (payload: unknown) => {
      socket.send(JSON.stringify({ type: 'increment', ...(payload as object) }));
    };
    const onActivity = (payload: unknown) => {
      socket.send(JSON.stringify({ type: 'activity', ...(payload as object) }));
    };
    emitter.on(`increment:${threadId}`, onIncrement);
    emitter.on(`activity:${threadId}`, onActivity);
    socket.on('close', () => {
      emitter.off(`increment:${threadId}`, onIncrement);
      emitter.off(`activity:${threadId}`, onActivity);
    });
  });

  return app;
}
