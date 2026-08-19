import {
  formatFreezeBallNote,
  parseApproveCommand,
  parseConfirmCommand,
  parseFreezeCommand,
  parseRejectCommand,
} from '@meowbase/shared';
import type { Message } from '@meowbase/shared';
import { gitCommit } from '../../services/git.js';
import { clip, turnLog } from '../../services/turn-log.js';
import { killHoldCommand } from '../../services/hold-command.js';
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
    const card = await context.stores.approvals.approve(approve.id);
    if (card) {
      try {
        await gitCommit(workdir, `approve ${card.id}`);
      } catch {
        // git 提交失败不阻塞;批准决策本身已生效
      }
      await context.stores.approvals.markApplied(card.id);
    }
    const reply = card
      ? `✅ 已批准并落地:${card.id}`
      : `⚠️ 找不到可批准的卡片:${approve.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
      systemKind: card ? 'approval-applied' : 'notice',
    });
  }

  if (parseFreezeCommand(content)) {
    turnLog('freeze', { thread: threadId });
    killHoldCommand(threadId);
    await context.stores.threads.setPendingHop(threadId, null);
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
