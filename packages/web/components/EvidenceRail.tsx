'use client';
import type { EvidenceDto } from '@/lib/api';

export function EvidenceRail({
  items,
  onCite,
  onConfirm,
}: {
  items: EvidenceDto[];
  onCite: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-raised)]/60 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-bold text-[var(--ink-soft)]">证据</span>
        {items.map((item) => (
          <span
            key={item.id}
            className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-[var(--border)]"
          >
            <button
              type="button"
              onClick={() => onCite(item.id)}
              className="font-medium hover:text-[var(--accent-strong)]"
              title={
                item.status === 'confirmed'
                  ? `${item.title}${item.confirmedAt ? ` · 确认于 ${item.confirmedAt.slice(0, 10)}` : ' · 确认时间未记'}`
                  : item.title
              }
            >
              #{item.id}
              <span className="ml-1 text-[var(--ink-soft)]">{item.title}</span>
            </button>
            {item.status === 'draft' ? (
              <button
                type="button"
                onClick={() => onConfirm(item.id)}
                className="text-[10px] font-bold text-[var(--accent-strong)]"
              >
                确认
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
