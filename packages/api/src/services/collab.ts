import { listThreadIndex, searchMessages, type AgentId, type CollabMessageHit, type CollabThreadRow } from '@meowbase/shared';
import type { AppStores } from '../stores/ports.js';

export async function loadCollabMessages(
  stores: Pick<AppStores, 'threads' | 'messages'>,
  input: { query: string; agentId?: AgentId; threadId?: string; limit?: number },
): Promise<CollabMessageHit[]> {
  const messages = input.threadId
    ? await stores.messages.list(input.threadId)
    : await listAllMessages(stores);
  return searchMessages(messages, {
    query: input.query,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.limit != null ? { limit: input.limit } : {}),
  });
}

export async function loadCollabThreads(
  stores: Pick<AppStores, 'threads'>,
): Promise<CollabThreadRow[]> {
  return listThreadIndex(await stores.threads.list());
}

async function listAllMessages(stores: Pick<AppStores, 'threads' | 'messages'>) {
  const threads = await stores.threads.list();
  const bundled = [];
  for (const thread of threads) {
    bundled.push(...(await stores.messages.list(thread.id)));
  }
  return bundled;
}
