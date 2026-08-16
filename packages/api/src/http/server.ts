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
import { executeTurn } from '../router/execute-turn.js';
import { gitInit } from '../services/git.js';

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
}

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const emitter = new EventEmitter();

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.post('/api/threads', async (request, reply) => {
    const body = request.body as { title?: string; primaryAgentId?: AgentId } | null;
    const thread = await deps.stores.threads.create({
      title: body?.title?.trim() || '新线程',
      primaryAgentId: body?.primaryAgentId ?? 'claude',
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
        onIncrement: (tid, messageId, delta) => {
          emitter.emit(`increment:${tid}`, { messageId, delta });
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
    const handler = (payload: unknown) => {
      socket.send(JSON.stringify({ type: 'increment', ...(payload as object) }));
    };
    emitter.on(`increment:${threadId}`, handler);
    socket.on('close', () => {
      emitter.off(`increment:${threadId}`, handler);
    });
  });

  return app;
}
