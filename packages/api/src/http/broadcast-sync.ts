import type { ApprovalStore, MessageStore, ThreadStore } from '../stores/ports.js';

export type SyncEmit = (threadId: string) => void;

function emitIfThread(emit: SyncEmit, threadId: string | undefined | null): void {
  if (!threadId) return;
  emit(threadId);
}

/** 消息写入成功后发 sync。读路径原样转发。 */
export function broadcastMessageSync(store: MessageStore, emit: SyncEmit): MessageStore {
  return {
    append: async (input) => {
      const result = await store.append(input);
      emit(input.threadId);
      return result;
    },
    get: (threadId, messageId) => store.get(threadId, messageId),
    list: (threadId) => store.list(threadId),
    deleteAll: (threadId) => store.deleteAll(threadId),
    patch: async (threadId, messageId, patch) => {
      const result = await store.patch(threadId, messageId, patch);
      emit(threadId);
      return result;
    },
  };
}

/** 审批卡成功变更后发 sync。threadId 从卡片或 create 入参取。 */
export function broadcastApprovalSync(store: ApprovalStore, emit: SyncEmit): ApprovalStore {
  return {
    create: async (input) => {
      const card = await store.create(input);
      emitIfThread(emit, card.threadId ?? input.threadId);
      return card;
    },
    get: (id) => store.get(id),
    list: (threadId) => store.list(threadId),
    setReviewComment: async (id, comment) => {
      const card = await store.setReviewComment(id, comment);
      emitIfThread(emit, card?.threadId);
      return card;
    },
    approve: async (id) => {
      const card = await store.approve(id);
      emitIfThread(emit, card?.threadId);
      return card;
    },
    reject: async (id, reason) => {
      const card = await store.reject(id, reason);
      emitIfThread(emit, card?.threadId);
      return card;
    },
    markApplied: async (id) => {
      const card = await store.markApplied(id);
      emitIfThread(emit, card?.threadId);
      return card;
    },
    void: async (id, reason) => {
      const card = await store.void(id, reason);
      emitIfThread(emit, card?.threadId);
      return card;
    },
  };
}

/** 球权与标题变更成功后发 sync。 */
export function broadcastThreadSync(store: ThreadStore, emit: SyncEmit): ThreadStore {
  return {
    create: (input) => store.create(input),
    get: (id) => store.get(id),
    list: () => store.list(),
    setLastApprovedSha: async (threadId, sha) => {
      await store.setLastApprovedSha(threadId, sha);
      emit(threadId);
    },
    setSeenPrCommentIds: async (threadId, ids) => {
      await store.setSeenPrCommentIds(threadId, ids);
      emit(threadId);
    },
    setSeenPrCheckIds: async (threadId, ids) => {
      await store.setSeenPrCheckIds(threadId, ids);
      emit(threadId);
    },
    setSeenPrMergeable: async (threadId, value) => {
      await store.setSeenPrMergeable(threadId, value);
      emit(threadId);
    },
    setSession: (threadId, agentId, sessionId) => store.setSession(threadId, agentId, sessionId),
    setPendingHop: async (threadId, hop) => {
      await store.setPendingHop(threadId, hop);
      emit(threadId);
    },
    enqueuePendingHop: async (threadId, hop) => {
      await store.enqueuePendingHop(threadId, hop);
      emit(threadId);
    },
    promoteQueuedHop: async (threadId) => {
      const promoted = await store.promoteQueuedHop(threadId);
      if (promoted) emit(threadId);
      return promoted;
    },
    clearPendingQueue: async (threadId) => {
      await store.clearPendingQueue(threadId);
      emit(threadId);
    },
    enqueueInbound: async (threadId, content) => {
      const item = await store.enqueueInbound(threadId, content);
      emit(threadId);
      return item;
    },
    shiftInbound: async (threadId) => {
      const item = await store.shiftInbound(threadId);
      if (item) emit(threadId);
      return item;
    },
    clearInboundQueue: async (threadId) => {
      await store.clearInboundQueue(threadId);
      emit(threadId);
    },
    steerInbound: async (threadId, id) => {
      const ok = await store.steerInbound(threadId, id);
      if (ok) emit(threadId);
      return ok;
    },
    steerPendingHop: async (threadId, hopId) => {
      const ok = await store.steerPendingHop(threadId, hopId);
      if (ok) emit(threadId);
      return ok;
    },
    setSopBoard: async (threadId, board) => {
      await store.setSopBoard(threadId, board);
      emit(threadId);
    },
    setRelayPairs: async (threadId, pairs) => {
      await store.setRelayPairs(threadId, pairs);
      emit(threadId);
    },
    clearPendingHopIfSame: async (threadId, hopId) => {
      const cleared = await store.clearPendingHopIfSame(threadId, hopId);
      if (cleared) emit(threadId);
      return cleared;
    },
    claimPendingHop: (threadId, runnerId, ttlMs) => store.claimPendingHop(threadId, runnerId, ttlMs),
    forceClaimPendingHop: (threadId, runnerId, ttlMs) =>
      store.forceClaimPendingHop(threadId, runnerId, ttlMs),
    renewPendingHopLease: (threadId, runnerId, ttlMs) =>
      store.renewPendingHopLease(threadId, runnerId, ttlMs),
    releasePendingHopLease: (threadId, runnerId) => store.releasePendingHopLease(threadId, runnerId),
    rename: async (id, title) => {
      const result = await store.rename(id, title);
      if (result) emit(id);
      return result;
    },
    delete: (id) => store.delete(id),
  };
}
