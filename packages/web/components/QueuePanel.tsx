'use client';

export interface QueueHop {
  id: string;
  from: string;
  to: string;
  task?: string;
}

export interface QueueInbound {
  id: string;
  content: string;
}

function clip(text: string, max = 48): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}

export function queueTriggerLabel(hopCount: number, inboundCount: number): string {
  const bits: string[] = [];
  if (hopCount > 0) bits.push(`后面还有 ${hopCount} 棒`);
  if (inboundCount > 0) bits.push(`还有 ${inboundCount} 句在等`);
  return bits.join(' · ');
}

export function QueuePanel({
  pendingQueue = [],
  inboundQueue = [],
  nameOf,
  open,
  onToggle,
  onSteer,
}: {
  pendingQueue?: QueueHop[];
  inboundQueue?: QueueInbound[];
  nameOf: (agentId?: string) => string;
  open?: boolean;
  onToggle?: () => void;
  onSteer?: (input: { kind: 'hop' | 'inbound'; id: string }) => void;
}) {
  const hopCount = pendingQueue.length;
  const inboundCount = inboundQueue.length;
  if (hopCount === 0 && inboundCount === 0) return null;

  const label = queueTriggerLabel(hopCount, inboundCount);
  const expanded = onToggle ? Boolean(open) : true;

  return (
    <div className="mt-1 max-w-md">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={onToggle ? expanded : undefined}
        className="rounded-full px-0 text-left text-[11px] font-medium text-[var(--accent-strong)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {label}
      </button>
      {expanded ? (
        <div className="mt-1.5 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 shadow-sm">
          {hopCount > 0 ? (
            <section>
              <p className="text-[10px] font-bold tracking-wide text-[var(--ink-soft)]">下一棒</p>
              <ol className="mt-1 space-y-1">
                {pendingQueue.map((hop, index) => (
                  <li key={hop.id} className="flex items-start justify-between gap-2 text-[11px] leading-4 text-[var(--ink)]">
                    <span className="min-w-0">
                      <span className="font-medium">
                        {nameOf(hop.from)} → {nameOf(hop.to)}
                      </span>
                      {hop.task ? (
                        <span className="mt-0.5 block text-[var(--ink-soft)]">{clip(hop.task)}</span>
                      ) : null}
                    </span>
                    {onSteer && index > 0 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-strong)] hover:bg-white/80"
                        onClick={() => onSteer({ kind: 'hop', id: hop.id })}
                      >
                        提到前面
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {inboundCount > 0 ? (
            <section>
              <p className="text-[10px] font-bold tracking-wide text-[var(--ink-soft)]">人说的</p>
              <ol className="mt-1 space-y-1">
                {inboundQueue.map((item, index) => (
                  <li key={item.id} className="flex items-start justify-between gap-2 text-[11px] leading-4 text-[var(--ink)]">
                    <span className="min-w-0">{clip(item.content)}</span>
                    {onSteer && index > 0 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-strong)] hover:bg-white/80"
                        onClick={() => onSteer({ kind: 'inbound', id: item.id })}
                      >
                        提到前面
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
