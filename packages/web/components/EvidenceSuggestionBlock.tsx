'use client';

export function EvidenceSuggestionBlock({
  evidenceId,
  title,
  onConfirm,
  onCite,
}: {
  evidenceId: string;
  title: string;
  onConfirm: (id: string) => void;
  onCite?: (id: string) => void;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-dashed border-[var(--border)] bg-white/70 p-3">
      <div className="mb-1 text-sm">💡 建议沉淀为证据:「{title}」</div>
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(evidenceId)}
          className="rounded-lg bg-[var(--accent)]/10 px-3 py-1 text-xs font-bold text-[var(--accent-strong)] transition hover:bg-[var(--accent)]/20"
        >
          确认沉淀
        </button>
        {onCite ? (
          <button
            type="button"
            onClick={() => onCite(evidenceId)}
            className="rounded-lg px-3 py-1 text-xs font-bold text-[var(--ink-soft)] ring-1 ring-[var(--border)] hover:bg-white"
          >
            引用 #{evidenceId}
          </button>
        ) : null}
      </div>
    </div>
  );
}
