'use client';
import { getPersona } from '@/lib/persona';

export function CatAvatar({
  agentId,
  name,
  size = 32,
  title,
  onClick,
}: {
  agentId: string;
  name?: string;
  size?: number;
  title?: string;
  onClick?: () => void;
}) {
  const persona = getPersona(agentId);
  const label = name ?? persona.name;
  const inner = (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ring-2 ring-white/80"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        background: persona.badge,
      }}
      title={title ?? label}
    >
      {label[0]}
    </span>
  );
  if (!onClick) return inner;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      aria-label={label}
    >
      {inner}
    </button>
  );
}
