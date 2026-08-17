import type { RelayHop } from '@/lib/ball';

const TONE: Record<RelayHop['status'], string> = {
  done: 'text-[var(--ink-soft)]',
  active: 'font-bold text-[var(--accent)]',
  failed: 'font-bold text-red-600',
  dropped: 'font-bold text-amber-700',
};

export function RelayTimeline({ hops }: { hops: RelayHop[] }) {
  if (hops.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px]">
      {hops.map((hop, index) => (
        <span key={`${hop.name}-${index}`} className="inline-flex items-center gap-x-1">
          {index > 0 ? <span className="text-[var(--ink-soft)]">→</span> : null}
          <span className={TONE[hop.status]}>{hop.name}</span>
        </span>
      ))}
    </div>
  );
}
