'use client';
import { useState } from 'react';
import type { ApprovalUiStatus } from '@/lib/parse-message';

function fileRows(stat: string): string[] {
  return stat
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const STATUS_LABEL: Record<ApprovalUiStatus, string> = {
  pending: '待你确认',
  applied: '已落地',
  rejected: '已打回',
};

export function ApprovalCardBlock({
  approvalId,
  stat,
  comment,
  writerName,
  reviewerName,
  status = 'pending',
  onApprove,
  onReject,
}: {
  approvalId: string;
  stat: string;
  comment: string;
  writerName?: string;
  reviewerName?: string;
  status?: ApprovalUiStatus;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const pending = status === 'pending';
  const files = fileRows(stat);

  return (
    <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-[0_10px_30px_-18px_rgba(40,30,20,0.45)] ring-1 ring-[var(--border)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--ink)]">改动待确认</div>
          <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
            {writerName ? `${writerName} 写` : '写手'}
            {reviewerName ? ` · ${reviewerName} 审` : ''}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            status === 'applied'
              ? 'bg-[var(--accent)]/10 text-[var(--accent-strong)]'
              : status === 'rejected'
                ? 'bg-red-50 text-red-700'
                : 'bg-[var(--surface)] text-[var(--ink-soft)]'
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      {files.length > 0 && (
        <ul className="mb-3 space-y-1">
          {files.map((file) => (
            <li
              key={file}
              className="rounded-lg bg-[var(--surface)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--ink-soft)]"
            >
              {file}
            </li>
          ))}
        </ul>
      )}
      {comment && (
        <details className="mb-3 rounded-xl bg-[var(--surface)] px-3 py-2" open={comment.length < 80}>
          <summary className="cursor-pointer text-xs font-bold text-[var(--ink-soft)]">审查意见</summary>
          <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]">{comment}</div>
        </details>
      )}
      {pending && !rejecting && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onApprove(approvalId)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white transition hover:bg-[var(--accent-strong)]"
          >
            批准落地
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--ink)] ring-1 ring-[var(--border)] transition hover:bg-black/5"
          >
            打回
          </button>
        </div>
      )}
      {pending && rejecting && (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--ink-soft)]">
            打回理由
            <input
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="哪里需要改"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReject(approvalId, reason.trim() || '打回')}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-bold text-white"
            >
              确认打回
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--ink-soft)]"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {status === 'applied' && (
        <p className="text-xs text-[var(--accent-strong)]">已写入这个线程，不用再操作。</p>
      )}
      {status === 'rejected' && (
        <p className="text-xs text-red-700">已打回，改动没有落地。</p>
      )}
      <div className="mt-2 font-mono text-[10px] text-[var(--ink-soft)]/70">{approvalId}</div>
    </div>
  );
}
