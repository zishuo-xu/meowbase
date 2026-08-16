'use client';

export function ApprovalCardBlock({
  approvalId,
  stat,
  comment,
  onApprove,
  onReject,
}: {
  approvalId: string;
  stat: string;
  comment: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-bold text-[var(--accent-strong)]">
          审批卡片
        </span>
        <code className="text-xs text-[var(--ink-soft)]">{approvalId}</code>
      </div>
      <pre className="mb-2 overflow-x-auto rounded-lg bg-[var(--surface)] p-2 text-xs text-[var(--ink-soft)]">
        {stat}
      </pre>
      <div className="mb-3 text-sm">审查意见:{comment}</div>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(approvalId)}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white transition hover:bg-[var(--accent-strong)]"
        >
          批准
        </button>
        <button
          onClick={() => onReject(approvalId)}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:bg-black/5"
        >
          打回
        </button>
      </div>
    </div>
  );
}
