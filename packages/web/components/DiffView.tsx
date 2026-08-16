'use client';
import { useState } from 'react';
import { parseUnifiedDiff, type DiffLineKind } from '@/lib/parse-diff';

const LINE: Record<DiffLineKind, string> = {
  add: 'bg-emerald-50 text-emerald-950',
  del: 'bg-red-50 text-red-900',
  ctx: 'text-[var(--ink-soft)]',
  meta: 'italic text-[var(--ink-soft)]',
};

const MARK: Record<DiffLineKind, string> = {
  add: '+',
  del: '-',
  ctx: ' ',
  meta: '\\',
};

export function DiffView({ diff }: { diff: string }) {
  const files = parseUnifiedDiff(diff);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(files.map((file, i) => [file.path, i === 0])),
  );
  if (files.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {files.map((file) => {
        const shown = open[file.path] ?? false;
        return (
          <div key={file.path} className="overflow-hidden rounded-lg bg-[var(--surface)]">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-mono text-[11px] text-[var(--ink)]"
              onClick={() => setOpen((prev) => ({ ...prev, [file.path]: !shown }))}
            >
              <span className={`inline-block transition-transform ${shown ? 'rotate-90' : ''}`}>▸</span>
              <span className="truncate">{file.path}</span>
            </button>
            {shown && (
              <div className="max-h-72 overflow-auto border-t border-[var(--border)] font-mono text-[11px] leading-snug">
                {file.hunks.map((hunk, hi) => (
                  <div key={`${file.path}-${hi}`}>
                    {hunk.header ? (
                      <div className="bg-black/[0.04] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]">
                        {hunk.header}
                      </div>
                    ) : null}
                    {hunk.lines.map((line, li) => (
                      <div key={li} className={`flex whitespace-pre px-2 ${LINE[line.kind]}`}>
                        <span className="mr-2 w-3 shrink-0 opacity-70">{MARK[line.kind]}</span>
                        <span className="min-w-0 break-all">{line.text}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
