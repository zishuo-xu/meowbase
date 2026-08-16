'use client';
import type { MessageDto } from '@/lib/api';
import { getPersona } from '@/lib/persona';
import { parseMessage, type ApprovalUiStatus } from '@/lib/parse-message';
import { ApprovalCardBlock } from './ApprovalCardBlock';
import { EvidenceSuggestionBlock } from './EvidenceSuggestionBlock';
import { CliProcessBlock } from './CliProcessBlock';

export function MessageBubble({
  message,
  agentName,
  writerName,
  reviewerName,
  approvalStatus,
  onApprove,
  onReject,
  onConfirmEvidence,
}: {
  message: MessageDto;
  agentName?: string;
  writerName?: string;
  reviewerName?: string;
  approvalStatus?: ApprovalUiStatus;
  onApprove?: (id: string) => void;
  onReject?: (id: string, reason: string) => void;
  onConfirmEvidence?: (id: string) => void;
}) {
  const parsed = parseMessage(message);

  if (parsed.kind === 'approval') {
    return (
      <div className="flex justify-start px-4 py-2">
        <ApprovalCardBlock
          approvalId={parsed.approvalId ?? ''}
          stat={parsed.stat ?? ''}
          comment={parsed.comment ?? ''}
          writerName={writerName}
          reviewerName={reviewerName}
          status={approvalStatus ?? parsed.approvalStatus ?? 'pending'}
          onApprove={onApprove ?? (() => {})}
          onReject={onReject ?? (() => {})}
        />
      </div>
    );
  }

  if (parsed.kind === 'evidence') {
    return (
      <div className="flex justify-start px-4 py-2">
        <EvidenceSuggestionBlock
          evidenceId={parsed.evidenceId ?? ''}
          title={parsed.title ?? ''}
          onConfirm={onConfirmEvidence ?? (() => {})}
        />
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="flex justify-center px-4 py-1">
        <span className="max-w-md rounded-full bg-black/5 px-3 py-1 text-xs text-[var(--ink-soft)]">
          {parsed.text}
        </span>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const persona = getPersona(isUser ? 'user' : message.agentId);
  const displayName = isUser ? persona.name : (agentName ?? persona.name);
  return (
    <div className={`flex gap-2 px-4 py-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <span
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ring-2 ring-white/70"
          style={{ background: persona.badge }}
        >
          {displayName[0]}
        </span>
      )}
      <div
        data-cat-ear={isUser ? undefined : 'true'}
        className={`relative max-w-[75%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-md border-[var(--border)] bg-white shadow-sm'
            : 'rounded-tl-none border-transparent shadow-sm'
        }`}
        style={isUser ? undefined : { background: persona.surface }}
      >
        {!isUser && (
          <div className="mb-0.5 text-xs font-bold" style={{ color: persona.badge }}>
            {displayName}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">
          {parsed.text}
          {message.status === 'streaming' && (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current align-middle opacity-60" />
          )}
        </div>
        {message.activities && message.activities.length > 0 && (
          <CliProcessBlock
            activities={message.activities}
            ended={message.status === 'failed' || message.status === 'terminated'}
          />
        )}
        {(message.status === 'failed' || message.status === 'terminated') && message.error && (
          <div className="mt-2 text-xs leading-relaxed text-red-700">失败: {message.error}</div>
        )}
      </div>
    </div>
  );
}
