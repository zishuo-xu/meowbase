'use client';
import { useEffect, useRef, useState } from 'react';
import { AGENT_ORDER, getPersona } from '@/lib/persona';
import { getMentionQuery } from '@/lib/mention';

interface MentionCandidate {
  id: string;
  name: string;
  badge: string;
}

const GROUP_CANDIDATE: MentionCandidate = {
  id: 'all',
  name: '全员',
  badge: 'var(--ink-soft)',
};

const DEFAULT_CANDIDATES: MentionCandidate[] = [
  GROUP_CANDIDATE,
  ...AGENT_ORDER.map((id) => ({
    id,
    name: getPersona(id).name,
    badge: getPersona(id).badge,
  })),
];

export function ChatInput({
  onSend,
  sending = false,
  agents,
  insert,
  onInserted,
  onAbort,
  focusSeq,
}: {
  onSend: (content: string) => void;
  sending?: boolean;
  agents?: { id: string; name: string }[];
  insert?: { id: number; text: string } | null;
  onInserted?: () => void;
  onAbort?: () => void;
  focusSeq?: number;
}) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 输入法组合状态:compositionstart 置 true,compositionend 置 false。
  // 比依赖 keydown 时的 nativeEvent.isComposing 可靠——部分输入法在
  // 回车确认组合的那一刻 isComposing 已是 false,但事件序列保证
  // compositionend 晚于该次 keydown。
  const composingRef = useRef(false);

  useEffect(() => {
    if (!insert?.text) return;
    setValue((prev) => {
      const pad = prev && !/\s$/.test(prev) ? ' ' : '';
      return `${prev}${pad}${insert.text} `;
    });
    onInserted?.();
  }, [insert?.id, insert?.text, onInserted]);

  useEffect(() => {
    if (focusSeq == null) return;
    textareaRef.current?.focus();
  }, [focusSeq]);

  const updateMention = (val: string, pos: number) => {
    const q = getMentionQuery(val, pos);
    setMenuOpen(q !== null);
    setQuery(q?.query ?? '');
    setActiveIdx(q?.query ? 0 : 1);
  };

  const candidates: MentionCandidate[] = [
    GROUP_CANDIDATE,
    ...(agents ?? DEFAULT_CANDIDATES.filter((c) => c.id !== 'all')).map((a) => ({
      id: a.id,
      name: a.name,
      badge: getPersona(a.id).badge,
    })),
  ];

  const filtered = query
    ? candidates.filter(
        (c) =>
          c.id.includes(query.toLowerCase()) || c.name.includes(query),
      )
    : candidates;

  const selectMention = (candidate: MentionCandidate) => {
    const q = getMentionQuery(value, cursor);
    if (!q) return;
    const inserted = `@${candidate.name} `;
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
    <div className="border-t border-[var(--border)] bg-[var(--surface-raised)]/80 p-3 backdrop-blur-sm">
      <div className="relative mx-auto max-w-3xl">
        {menuOpen && filtered.length > 0 && (
          <div className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
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
            <div className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] leading-snug text-[var(--ink-soft)]">
              Enter / Tab 选中 · ↑↓ 移动 · Esc 关闭
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onChange={(e) => {
              setValue(e.target.value);
              setCursor(e.target.selectionStart);
              updateMention(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              // 输入法组合中(拼音/英文候选确认)的回车不提交、不触发补全选择
              if (
                composingRef.current ||
                e.nativeEvent.isComposing ||
                e.keyCode === 229
              ) {
                return;
              }
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
                if (e.key === 'Enter' || e.key === 'Tab') {
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
            placeholder="@墨墨 干活吧…(不写 @ 会续上一只 / 行首 @名字 换猫 · ⇧↵换行)"
            className="min-w-0 flex-1 resize-none rounded-2xl border border-[var(--border)] bg-white px-3.5 py-2.5 text-sm shadow-inner outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 disabled:opacity-60"
          />
          {sending && onAbort ? (
            <button
              type="button"
              onClick={onAbort}
              className="shrink-0 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-red-700 shadow-sm ring-1 ring-red-200 transition hover:bg-red-50"
            >
              中止
            </button>
          ) : null}
          <button
            onClick={submit}
            className="shrink-0 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--accent-strong)]"
          >
            {sending ? '排队' : '发送'}
          </button>
        </div>
        <p className="mt-1 truncate px-1 text-[10px] leading-4 text-[var(--ink-soft)]">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </div>
  );
}
