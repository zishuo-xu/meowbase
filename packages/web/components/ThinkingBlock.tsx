'use client';
import { useState } from 'react';

export function ThinkingBlock({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const text = content.trim();
  const [open, setOpen] = useState(false);
  if (!text && !streaming) return null;

  return (
    <div className="mb-2 rounded-lg bg-black/[0.04] px-2 py-1.5 text-[11px] leading-snug text-[var(--ink-soft)]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`inline-block transition-transform ${open && text ? 'rotate-90' : ''}`}>▸</span>
        <span>{streaming ? '思考中…' : '思考过程'}</span>
      </button>
      {open && text ? (
        <div className="mt-1 whitespace-pre-wrap break-words px-1 py-0.5 italic">{content}</div>
      ) : null}
    </div>
  );
}
