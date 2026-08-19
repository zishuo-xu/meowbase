import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket, { type WebSocket } from '@fastify/websocket';
import type { AgentId, AuditAction, AuditActor } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type { AppStores } from '../stores/ports.js';
import { AUDIT_LIST_MAX } from '../stores/ports.js';
import { auditApprovals, auditMessages } from '../stores/audit-log.js';
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
import {
  broadcastApprovalSync,
  broadcastMessageSync,
  broadcastThreadSync,
} from './broadcast-sync.js';
import { executeTurn, type TurnContext } from '../router/execute-turn.js';
import {
  createPendingRunner,
  HOP_LEASE_RENEW_MS,
  HOP_LEASE_TTL_MS,
  HOP_SWEEP_INTERVAL_MS,
} from '../router/pending-runner.js';
import {
  gitBranchExists,
  gitCurrentBranch,
  gitInit,
  gitIsRepo,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreePrune,
  gitWorktreeRemove,
} from '../services/git.js';
import { verifyModelConnection } from '../providers/verify-model.js';
import { loadUsage } from '../services/usage.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 只有绑上端口的那个进程才该叫:首扫会强抢死者租约 */
    startPendingRunner: () => void;
  }
}

export interface ApiDeps {
  stores: AppStores;
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
  /** 收尸 interval;0 则只在 startPendingRunner 时扫一次,不挂定时器 */
  hopSweepIntervalMs?: number;
}

interface LiveConfig {
  a2aMaxDepth: number;
  defaultAgentId: AgentId;
  agents: AgentSpec[];
  models: ModelPreset[];
}

function parseAuditLimit(raw: unknown): { ok: true; limit?: number } | { ok: false } {
  if (raw === undefined || raw === '') return { ok: true };
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > AUDIT_LIST_MAX) return { ok: false };
  return { ok: true, limit: n };
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
  const emitSync = (threadId: string) => {
    emitter.emit(`sync:${threadId}`, { threadId });
  };
  const stores = {
    threads: broadcastThreadSync(deps.stores.threads, emitSync),
    messages: broadcastMessageSync(auditMessages(deps.stores.messages, deps.stores.audit), emitSync),
    profiles: deps.stores.profiles,
    evidence: deps.stores.evidence,
    skills: deps.stores.skills,
    approvals: broadcastApprovalSync(
      auditApprovals(deps.stores.approvals, deps.stores.audit),
      emitSync,
    ),
    audit: deps.stores.audit,
  };
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
    const profiles = await stores.profiles.list();
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
    const body = request.body as {
      title?: string;
      primaryAgentId?: AgentId;
      repoPath?: string;
      baseBranch?: string;
    } | null;
    const repoPathRaw = body?.repoPath?.trim();
    if (repoPathRaw) {
      const repoPath = resolve(repoPathRaw);
      if (!existsSync(repoPath)) {
        return reply.code(400).send({ error: '仓库路径不存在' });
      }
      if (!(await gitIsRepo(repoPath))) {
        return reply.code(400).send({ error: '路径不是 git 仓库' });
      }
      const baseBranch = body?.baseBranch?.trim() || (await gitCurrentBranch(repoPath));
      if (!baseBranch || !(await gitBranchExists(repoPath, baseBranch))) {
        return reply.code(400).send({ error: `分支不存在: ${baseBranch || '(空)'}` });
      }
      const thread = await stores.threads.create({
        title: body?.title?.trim() || '新会话',
        primaryAgentId: body?.primaryAgentId ?? live.defaultAgentId,
        workdirBase: deps.workdirBase,
        repo: { path: repoPath, baseBranch },
      });
      const workdir = resolve(thread.workdir);
      const listed = await gitWorktreeList(repoPath);
      const occupied =
        existsSync(workdir) ||
        listed.some((p) => p === workdir || p.endsWith(thread.id));
      if (occupied) {
        await stores.threads.delete(thread.id);
        return reply.code(400).send({ error: 'worktree 路径已被占用' });
      }
      try {
        // 绑仓:git 自己建目录。绝不能 mkdir / 写 package.json / gitInit
        // gitInit 会覆盖工作区里的 .gitignore
        await gitWorktreeAdd(repoPath, workdir, thread.repo!.branch, baseBranch);
      } catch {
        await stores.threads.delete(thread.id);
        try {
          rmSync(workdir, { recursive: true, force: true });
        } catch {
          // 目录可能没建出来
        }
        try {
          await gitWorktreePrune(repoPath);
        } catch {
          // 清理失败不掩盖创建失败
        }
        return reply.code(400).send({ error: '创建 worktree 失败' });
      }
      return reply.code(201).send(thread);
    }
    const thread = await stores.threads.create({
      title: body?.title?.trim() || '新会话',
      primaryAgentId: body?.primaryAgentId ?? live.defaultAgentId,
      workdirBase: deps.workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    // 先写 package.json 再建基线:让 opencode 把沙箱目录识别为项目根,
    // 避免它上溯到仓库根导致文件写到沙箱外;且不污染 diff 基线
    writeFileSync(
      join(thread.workdir, 'package.json'),
      JSON.stringify({ name: 'meowbase-thread', private: true, type: 'module' }, null, 2),
    );
    await gitInit(thread.workdir);
    return reply.code(201).send(thread);
  });

  app.get('/api/threads', async () => stores.threads.list());

  app.delete('/api/threads/:threadId', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = await stores.threads.get(threadId);
    if (!thread) return reply.code(404).send({ error: `线程不存在: ${threadId}` });
    await stores.messages.deleteAll(threadId);
    await stores.threads.delete(threadId);
    if (thread.repo) {
      try {
        await gitWorktreeRemove(thread.repo.path, resolve(thread.workdir));
      } catch {
        try {
          rmSync(thread.workdir, { recursive: true, force: true });
        } catch {
          // 目录已不在
        }
        try {
          await gitWorktreePrune(thread.repo.path);
        } catch {
          // prune 失败不阻塞删线程
        }
      }
    } else {
      try {
        rmSync(thread.workdir, { recursive: true, force: true });
      } catch {
        // 沙箱目录不在不影响删线程
      }
    }
    return { ok: true };
  });

  app.get('/api/profiles', async () => stores.profiles.list());

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
      await stores.profiles.updateAutoApprove(agentId, body.autoApprove);
    }
    if (adapterRuntimeChanged(prev, next)) {
      deps.rebuildAdapter?.(next);
    }
    persist();
    const profile = await stores.profiles.get(agentId);
    return publicAgentConfig(next, { autoApprove: profile?.autoApprove });
  });

  app.patch('/api/profiles/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { autoApprove?: boolean } | null;
    if (typeof body?.autoApprove !== 'boolean') {
      return reply.code(400).send({ error: 'autoApprove 必须是布尔值' });
    }
    const updated = await stores.profiles.updateAutoApprove(
      agentId as AgentId,
      body.autoApprove,
    );
    if (!updated) return reply.code(404).send({ error: `profile 不存在: ${agentId}` });
    return reply.code(200).send(updated);
  });

  app.get('/api/evidence', async (request) => {
    const { threadId } = request.query as { threadId?: string };
    return stores.evidence.list(threadId);
  });

  app.get('/api/skills', async () => stores.skills.list());

  app.get('/api/approvals', async (request) => {
    const { threadId } = request.query as { threadId?: string };
    return stores.approvals.list(threadId);
  });

  app.get('/api/usage', async (request) => {
    const { threadId } = request.query as { threadId?: string };
    return loadUsage(stores, threadId);
  });

  app.get('/api/audit', async (request, reply) => {
    const query = request.query as {
      threadId?: string;
      actor?: string;
      action?: string;
      since?: string;
      limit?: string;
    };
    const parsedLimit = parseAuditLimit(query.limit);
    if (!parsedLimit.ok) return reply.code(400).send({ error: 'limit 无效' });
    return stores.audit.list({
      threadId: query.threadId,
      actor: query.actor as AuditActor | undefined,
      action: query.action as AuditAction | undefined,
      since: query.since,
      limit: parsedLimit.limit,
    });
  });

  app.get('/api/threads/:threadId/messages', async (request) => {
    const { threadId } = request.params as { threadId: string };
    return stores.messages.list(threadId);
  });

  const runningTurns = new Map<string, AbortController>();

  function createTurnContext(threadId: string): { context: TurnContext; release: () => void } {
    const ac = new AbortController();
    runningTurns.set(threadId, ac);
    const context: TurnContext = {
      stores,
      registry: deps.registry,
      a2aMaxDepth: live.a2aMaxDepth,
      agents: live.agents.length > 0 ? live.agents : deps.agents,
      signal: ac.signal,
      onIncrement: (tid, messageId, delta, agentId) => {
        emitter.emit(`increment:${tid}`, { messageId, delta, agentId });
      },
      onActivity: (tid, messageId, activity, agentId) => {
        emitter.emit(`activity:${tid}`, { messageId, activity, agentId });
      },
      onStart: (tid, messageId, agentId) => {
        emitter.emit(`start:${tid}`, { messageId, agentId });
      },
      onThinking: (tid, messageId, delta, agentId) => {
        emitter.emit(`thinking:${tid}`, { messageId, delta, agentId });
      },
    };
    return {
      context,
      release: () => {
        if (runningTurns.get(threadId) === ac) runningTurns.delete(threadId);
      },
    };
  }

  const runner = createPendingRunner({
    threads: stores.threads,
    messages: stores.messages,
    audit: stores.audit,
    createContext: createTurnContext,
    leaseTtlMs: HOP_LEASE_TTL_MS,
    leaseRenewMs: HOP_LEASE_RENEW_MS,
    sweepIntervalMs: deps.hopSweepIntervalMs ?? HOP_SWEEP_INTERVAL_MS,
  });
  // 开机首扫会强抢租约,所以只能等真正绑上端口再叫:onReady 在 EADDRINUSE 时也会跑完,
  // 那种起不来的进程去强抢,会把旧进程正在跑的一跳跑两遍。绑上端口才是「我是唯一实例」。
  app.decorate('startPendingRunner', () => runner.start());
  app.addHook('onClose', async () => {
    runner.stop();
  });

  app.post('/api/threads/:threadId/cancel', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const running = runningTurns.get(threadId);
    if (!running) return reply.code(409).send({ error: '当前没有进行中的一轮' });
    running.abort();
    return { ok: true };
  });

  app.post('/api/threads/:threadId/messages', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = request.body as { content?: string } | null;
    const content = body?.content?.trim();
    if (!content) {
      return reply.code(400).send({ error: 'content 不能为空' });
    }
    const prepared = createTurnContext(threadId);
    try {
      const message = await executeTurn({
        threadId,
        content,
        context: prepared.context,
      });
      void runner.run(threadId, prepared);
      return reply.code(200).send(message);
    } catch (err) {
      prepared.release();
      throw err;
    }
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
    const onStart = (payload: unknown) => {
      socket.send(JSON.stringify({ type: 'start', ...(payload as object) }));
    };
    const onThinking = (payload: unknown) => {
      socket.send(JSON.stringify({ type: 'thinking', ...(payload as object) }));
    };
    const onSync = (payload: unknown) => {
      socket.send(JSON.stringify({ type: 'sync', ...(payload as object) }));
    };
    emitter.on(`increment:${threadId}`, onIncrement);
    emitter.on(`activity:${threadId}`, onActivity);
    emitter.on(`start:${threadId}`, onStart);
    emitter.on(`thinking:${threadId}`, onThinking);
    emitter.on(`sync:${threadId}`, onSync);
    socket.on('close', () => {
      emitter.off(`increment:${threadId}`, onIncrement);
      emitter.off(`activity:${threadId}`, onActivity);
      emitter.off(`start:${threadId}`, onStart);
      emitter.off(`thinking:${threadId}`, onThinking);
      emitter.off(`sync:${threadId}`, onSync);
    });
  });

  return app;
}
