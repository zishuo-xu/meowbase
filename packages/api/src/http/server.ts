import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket, { type WebSocket } from '@fastify/websocket';
import type { AgentId } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type {
  EvidenceStore,
  MessageStore,
  ProfileStore,
  ThreadStore,
} from '../stores/ports.js';
import { executeTurn } from '../router/execute-turn.js';

export interface ApiDeps {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
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
    return reply.code(201).send(thread);
  });

  app.get('/api/threads', async () => deps.stores.threads.list());

  app.get('/api/profiles', async () => deps.stores.profiles.list());

  app.get('/api/evidence', async (request) => {
    const { threadId } = request.query as { threadId?: string };
    return deps.stores.evidence.list(threadId);
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
