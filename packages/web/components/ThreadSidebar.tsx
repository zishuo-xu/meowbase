'use client';
import type { ThreadDto } from '@/lib/api';
import { AGENT_ORDER, getPersona } from '@/lib/persona';

export function ThreadSidebar({
  threads,
  activeId,
  onSelect,
  onCreate,
}: {
  threads: ThreadDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string, primaryAgentId: string) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-white/50">
      <div className="p-3">
        <button
          onClick={() => onCreate(`新线程 ${threads.length + 1}`, 'claude')}
          className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white transition hover:bg-[var(--accent-strong)]"
        >
          + 新线程
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            className={`mb-1 w-full rounded-xl px-3 py-2 text-left transition ${
              thread.id === activeId
                ? 'bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/30'
                : 'hover:bg-black/5'
            }`}
          >
            <div className="truncate text-sm font-medium">{thread.title}</div>
            <div className="flex items-center gap-1 text-xs text-[var(--ink-soft)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: getPersona(thread.primaryAgentId).badge }}
              />
              {new Date(thread.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </button>
        ))}
        {threads.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[var(--ink-soft)]">
            还没有线程,点上面新建
          </div>
        )}
      </nav>
      <div className="border-t border-[var(--border)] p-3 text-xs text-[var(--ink-soft)]">
        {AGENT_ORDER.map((id) => (
          <div key={id} className="mb-1 flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: getPersona(id).badge }}
            />
            {getPersona(id).name}
          </div>
        ))}
      </div>
    </aside>
  );
}
