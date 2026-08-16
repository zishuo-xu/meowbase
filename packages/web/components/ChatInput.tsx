'use client';
import { useState } from 'react';

export function ChatInput({ onSend }: { onSend: (content: string) => void }) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="border-t border-[var(--border)] bg-white/60 p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="@墨墨 干活吧…(支持 #learn / #confirm / #ev_ / #approve)"
          className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={submit}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--accent-strong)]"
        >
          发送
        </button>
      </div>
    </div>
  );
}
