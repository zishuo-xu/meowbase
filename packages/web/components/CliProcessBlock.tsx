'use client';
import { useEffect, useRef, useState } from 'react';
import type { ToolActivity } from '@/lib/api';

function displayActivities(activities: ToolActivity[], ended?: boolean): ToolActivity[] {
  if (!ended) return activities;
  return activities.map((a) => (a.status === 'running' ? { ...a, status: 'error' as const } : a));
}

export function CliProcessBlock({
  activities,
  ended,
}: {
  activities: ToolActivity[];
  ended?: boolean;
}) {
  const rows = displayActivities(activities, ended);
  const running = rows.some((a) => a.status === 'running');
  const [open, setOpen] = useState(running);
  const userTouched = useRef(false);
  useEffect(() => {
    if (userTouched.current) return;
    setOpen(running);
  }, [running]);
  if (rows.length === 0) return null;

  const current = [...rows].reverse().find((a) => a.status === 'running');
  const summary = current
    ? `CLI · ${current.name}${current.arg ? ` ${current.arg}` : ''}…`
    : `CLI · ${rows.length} 个工具`;

  return (
    <div className="mt-2 rounded-lg bg-black/[0.04] px-2 py-1.5 font-mono text-[11px] leading-snug text-[var(--ink-soft)]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => {
          userTouched.current = true;
          setOpen((v) => !v);
        }}
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="truncate">{summary}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 truncate px-1 py-0.5">
              <span
                aria-label={
                  a.status === 'running' ? '工具进行中' : a.status === 'error' ? '工具失败' : '工具完成'
                }
              >
                {a.status === 'running' ? '…' : a.status === 'error' ? '!' : '✓'}
              </span>
              <span className="font-medium text-[var(--ink)]">{a.name}</span>
              {a.arg && <span className="truncate">{a.arg}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
