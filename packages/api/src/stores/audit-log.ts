import { clipAuditSubject, type AuditRow } from '@meowbase/shared';
import { clip, turnLog } from '../services/turn-log.js';
import type { ApprovalStore, AuditStore, MessageStore } from './ports.js';

export async function safeAppendAudit(
  audit: AuditStore,
  input: Omit<AuditRow, 'id' | 'ts'>,
): Promise<void> {
  try {
    await audit.append(input);
  } catch (err) {
    turnLog('audit fail', {
      thread: input.threadId,
      action: input.action,
      error: clip(String(err), 120),
    });
  }
}

/** 消息写入成功后派生审计行。读路径原样转发。 */
export function auditMessages(store: MessageStore, audit: AuditStore): MessageStore {
  return {
    append: async (input) => {
      const result = await store.append(input);
      if (input.role === 'system') {
        await safeAppendAudit(audit, {
          threadId: input.threadId,
          actor: 'platform',
          action: input.systemKind,
          subject: clipAuditSubject(input.content),
          meta: { messageId: result.id, ...input.systemMeta },
        });
      } else if (input.role === 'user') {
        await safeAppendAudit(audit, {
          threadId: input.threadId,
          actor: 'human',
          action: 'user-say',
          subject: clipAuditSubject(input.content),
          meta: { messageId: result.id },
        });
      }
      return result;
    },
    get: (threadId, messageId) => store.get(threadId, messageId),
    list: (threadId) => store.list(threadId),
    deleteAll: (threadId) => store.deleteAll(threadId),
    patch: async (threadId, messageId, patch) => {
      const result = await store.patch(threadId, messageId, patch);
      if (!result) return result;
      if (patch.status === 'completed') {
        await safeAppendAudit(audit, {
          threadId,
          actor: result.agentId ?? 'platform',
          action: 'hop-done',
          subject: clipAuditSubject(result.content),
          meta: {
            messageId: result.id,
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.hopId ? { hopId: result.hopId } : {}),
          },
        });
      } else if (patch.status === 'failed' || patch.status === 'terminated') {
        await safeAppendAudit(audit, {
          threadId,
          actor: result.agentId ?? 'platform',
          action: 'hop-failed',
          subject: clipAuditSubject(result.content || result.error || ''),
          meta: {
            messageId: result.id,
            ...(result.hopId ? { hopId: result.hopId } : {}),
          },
        });
      }
      return result;
    },
  };
}

/** 审批卡成功变更后派生审计行。读路径原样转发。 */
export function auditApprovals(store: ApprovalStore, audit: AuditStore): ApprovalStore {
  return {
    create: async (input) => {
      const card = await store.create(input);
      await safeAppendAudit(audit, {
        threadId: card.threadId,
        actor: 'platform',
        action: 'approval-created',
        subject: clipAuditSubject(card.diffStat),
        meta: {
          approvalId: card.id,
          writerAgentId: card.writerAgentId,
          reviewerAgentId: card.reviewerAgentId,
        },
      });
      return card;
    },
    get: (id) => store.get(id),
    list: (threadId) => store.list(threadId),
    setReviewComment: (id, comment) => store.setReviewComment(id, comment),
    approve: async (id) => {
      const card = await store.approve(id);
      if (!card) return card;
      await safeAppendAudit(audit, {
        threadId: card.threadId,
        actor: 'platform',
        action: 'approval-approved',
        subject: clipAuditSubject(card.diffStat),
        meta: {
          approvalId: card.id,
          writerAgentId: card.writerAgentId,
          reviewerAgentId: card.reviewerAgentId,
          status: card.status,
          ...(card.reviewComment ? { reviewComment: card.reviewComment } : {}),
        },
      });
      return card;
    },
    reject: async (id, reason) => {
      const card = await store.reject(id, reason);
      if (!card) return card;
      await safeAppendAudit(audit, {
        threadId: card.threadId,
        actor: 'platform',
        action: 'approval-rejected',
        subject: clipAuditSubject(reason),
        meta: {
          approvalId: card.id,
          rejectReason: card.rejectReason ?? reason,
        },
      });
      return card;
    },
    markApplied: async (id) => {
      const card = await store.markApplied(id);
      if (!card) return card;
      await safeAppendAudit(audit, {
        threadId: card.threadId,
        actor: 'platform',
        action: 'approval-applied',
        subject: clipAuditSubject(card.diffStat),
        meta: { approvalId: card.id },
      });
      return card;
    },
  };
}
