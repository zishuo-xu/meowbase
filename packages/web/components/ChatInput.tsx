'use client';
import { useRef, useState } from 'react';
import { AGENT_ORDER, getPersona } from '@/lib/persona';
import { getMentionQuery } from '@/lib/mention';

interface MentionCandidate {
  id: string;
  name: string;
  badge: string;
}

const CANDIDATES: MentionCandidate[] = AGENT_ORDER.map((id) => ({
  id,
  name: getPersona(id).name,
  badge: getPersona(id).badge,
}));

export function ChatInput({ onSend }: { onSend: (content: string) => void }) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const updateMention = (val: string, pos: number) => {
    const q = getMentionQuery(val, pos);
    setMenuOpen(q !== null);
    setQuery(q?.query ?? '');
    setActiveIdx(0);
  };

  const filtered = query
    ? CANDIDATES.filter(
        (c) =>
          c.id.includes(query.toLowerCase()) || c.name.includes(query),
      )
    : CANDIDATES;

  const selectMention = (candidate: MentionCandidate) => {
    const q = getMentionQuery(value, cursor);
    if (!q) return;
    const inserted = `@${candidate.id} `;
    const next = value.slice(0, q.start) + inserted + value.slice(cursor);
    setValue(next);
    setMenuOpen(false);
    const newCursor = q.start + inserted.length;
    setCursor(newCursor);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
    });
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
    setMenuOpen(false);
  };

  return (
    <div className="border-t border-[var(--border)] bg-white/60 p-3">
      <div className="relative flex items-end gap-2">
        {menuOpen && filtered.length > 0 && (
          <div className="absolute bottom-full left-0 z-10 mb-1 w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
            {filtered.map((c, idx) => (
              <button
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectMention(c)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  idx === activeIdx ? 'bg-[var(--accent)]/10' : ''
                }`}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: c.badge }}
                >
                  {c.name[0]}
                </span>
                {c.name}
                <code className="ml-auto text-xs text-[var(--ink-soft)]">
                  @{c.id}
                </code>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCursor(e.target.selectionStart);
            updateMention(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            // 输入法组合中(拼音选词)的回车不提交、不触发补全选择
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (menuOpen && filtered.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((idx) => (idx + 1) % filtered.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx(
                  (idx) => (idx - 1 + filtered.length) % filtered.length,
                );
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                selectMention(filtered[activeIdx] ?? filtered[0]!);
                return;
              }
              if (e.key === 'Escape') {
                setMenuOpen(false);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="@墨墨 干活吧…(可 @ 多个角色同题并行 / #learn / #confirm / #approve)"
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
