'use client';

export function EvidenceSuggestionBlock({
  evidenceId,
  title,
  onConfirm,
}: {
  evidenceId: string;
  title: string;
  onConfirm: (id: string) => void;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-dashed border-[var(--border)] bg-white/70 p-3">
      <div className="mb-1 text-sm">💡 建议沉淀为证据:「{title}」</div>
      <button
        onClick={() => onConfirm(evidenceId)}
        className="rounded-lg bg-[var(--accent)]/10 px-3 py-1 text-xs font-bold text-[var(--accent-strong)] transition hover:bg-[var(--accent)]/20"
      >
        确认沉淀
      </button>
    </div>
  );
}
