'use client';
import { useState } from 'react';
import type { ToolActivity } from '@/lib/api';

export function CliProcessBlock({ activities }: { activities: ToolActivity[] }) {
  const [open, setOpen] = useState(true);
  if (activities.length === 0) return null;

  const current = [...activities].reverse().find((a) => a.status === 'running');
  const summary = current
    ? `CLI · ${current.name}${current.arg ? ` ${current.arg}` : ''}…`
    : `CLI · ${activities.length} 个工具`;

  return (
    <div className="mt-2 rounded-lg bg-black/[0.04] px-2 py-1.5 font-mono text-[11px] leading-snug text-[var(--ink-soft)]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="truncate">{summary}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {activities.map((a) => (
            <li key={a.id} className="flex items-center gap-2 truncate px-1 py-0.5">
              <span aria-hidden="true">{a.status === 'running' ? '…' : a.status === 'error' ? '!' : '✓'}</span>
              <span className="font-medium text-[var(--ink)]">{a.name}</span>
              {a.arg && <span className="truncate">{a.arg}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
