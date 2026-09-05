import {
  formatFreezeBallNote,
  parseApproveCommand,
  parseConfirmCommand,
  parseFreezeCommand,
  parseRejectCommand,
} from '@meowbase/shared';
import type { Message } from '@meowbase/shared';
import { clip, turnLog } from '../../services/turn-log.js';
import { killHoldCommand } from '../../services/hold-command.js';
import { formatApproveVoidedReply } from '../../services/pr.js';
import { landApprovedCard } from './land-approval.js';
import type { TurnContext } from './types.js';

export async function handleSystemCommand(input: {
  threadId: string;
  content: string;
  context: TurnContext;
  workdir: string;
}): Promise<Message | null> {
  const { threadId, content, context, workdir } = input;

  const confirm = parseConfirmCommand(content);
  if (confirm) {
    turnLog('confirm', { thread: threadId, id: confirm.id });
    const entry = await context.stores.evidence.confirm(confirm.id);
    const reply = entry
      ? `✅ 已沉淀:${entry.title}`
      : `⚠️ 找不到可确认的证据:${confirm.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
      systemKind: 'notice',
    });
  }

  const approve = parseApproveCommand(content);
  if (approve) {
    turnLog('approve', { thread: threadId, id: approve.id });
    const existing = await context.stores.approvals.get(approve.id);
    if (existing?.status === 'voided') {
      return context.stores.messages.append({
        threadId,
        role: 'system',
        content: formatApproveVoidedReply({
          cardId: existing.id,
          reason: existing.voidReason ?? '已失效',
        }),
        status: 'completed',
        systemKind: 'notice',
      });
    }
    let card = existing;
    if (card && (card.status === 'draft' || card.status === 'reviewing')) {
      card = (await context.stores.approvals.approve(approve.id)) ?? card;
    }
    if (!card || (card.status !== 'approved' && card.status !== 'applied')) {
      return context.stores.messages.append({
        threadId,
        role: 'system',
        content: `⚠️ 找不到可批准的卡片:${approve.id}`,
        status: 'completed',
        systemKind: 'notice',
      });
    }
    if (card.status === 'applied') {
      return context.stores.messages.append({
        threadId,
        role: 'system',
        content: `✅ 已批准并落地:${card.id}`,
        status: 'completed',
        systemKind: 'approval-applied',
      });
    }
    const thread = await context.stores.threads.get(threadId);
    const land = await landApprovedCard({
      context,
      threadId,
      workdir,
      cardId: card.id,
      repo: thread?.repo,
    });
    if (land.ok) {
      return context.stores.messages.append({
        threadId,
        role: 'system',
        content: `✅ 已批准并落地:${card.id}`,
        status: 'completed',
        systemKind: 'approval-applied',
      });
    }
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: `⚠️ 批准记下了，但提交失败：${land.reason}`,
      status: 'completed',
      systemKind: 'approval-failed',
    });
  }

  if (parseFreezeCommand(content)) {
    turnLog('freeze', { thread: threadId });
    killHoldCommand(threadId);
    await context.stores.threads.setPendingHop(threadId, null);
    await context.stores.threads.clearPendingQueue(threadId);
    await context.stores.threads.clearInboundQueue(threadId);
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: formatFreezeBallNote(),
      status: 'completed',
      systemKind: 'freeze',
    });
  }

  const reject = parseRejectCommand(content);
  if (reject) {
    turnLog('reject', { thread: threadId, id: reject.id, reason: clip(reject.reason, 40) });
    const card = await context.stores.approvals.reject(reject.id, reject.reason);
    const reply = card
      ? `⛔ 已打回:${card.id} 理由:${reject.reason || '(未填)'}`
      : `⚠️ 找不到可打回的卡片:${reject.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
      systemKind: 'notice',
    });
  }

  return null;
}
