'use client';
import type { AgentConfigDto, ThreadDto } from '@/lib/api';
import { AGENT_ORDER, agentName, getPersona } from '@/lib/persona';
import { CatAvatar } from './CatAvatar';

export function ThreadSidebar({
  threads,
  activeId,
  agents,
  defaultAgentId,
  onSelect,
  onCreate,
  onOpenTeam,
}: {
  threads: ThreadDto[];
  activeId: string | null;
  agents?: AgentConfigDto[];
  defaultAgentId?: string;
  onSelect: (id: string) => void;
  onCreate: (title: string, primaryAgentId: string) => void;
  onOpenTeam?: (agentId?: string) => void;
}) {
  const roster =
    agents && agents.length > 0
      ? agents
      : AGENT_ORDER.map((id) => ({
          id,
          name: getPersona(id).name,
          role: '',
          aliases: [],
          bin: id,
        }));
  const primary = defaultAgentId ?? roster[0]?.id ?? 'claude';

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-raised)]/70 backdrop-blur-sm">
      <div className="px-4 pb-2 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm text-white shadow-sm">
            喵
          </span>
          <div>
            <div className="text-sm font-bold leading-none">喵窝</div>
            <div className="mt-1 text-[11px] text-[var(--ink-soft)]">多猫协作</div>
          </div>
        </div>
        <button
          onClick={() => onCreate(`新线程 ${threads.length + 1}`, primary)}
          className="w-full rounded-2xl bg-[var(--accent)] px-3 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--accent-strong)]"
        >
          + 新线程
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            className={`mb-1 w-full rounded-2xl px-3 py-2.5 text-left transition ${
              thread.id === activeId
                ? 'bg-[var(--accent)]/10 shadow-sm ring-1 ring-[var(--accent)]/30'
                : 'hover:bg-black/5'
            }`}
          >
            <div className="truncate text-sm font-medium">{thread.title}</div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
              <CatAvatar
                agentId={thread.primaryAgentId}
                name={agentName(thread.primaryAgentId, agents)}
                size={14}
              />
              {agentName(thread.primaryAgentId, agents)}
              <span className="ml-auto">
                {new Date(thread.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </button>
        ))}
        {threads.length === 0 && (
          <div className="px-3 py-10 text-center text-xs leading-relaxed text-[var(--ink-soft)]">
            还没有线程
            <br />
            点上面新建,和猫们开工
          </div>
        )}
      </nav>
      <div className="border-t border-[var(--border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-wide text-[var(--ink-soft)]">
            团队
          </span>
          <button
            type="button"
            onClick={() => onOpenTeam?.()}
            className="text-[11px] font-bold text-[var(--accent-strong)] hover:underline"
          >
            配置
          </button>
        </div>
        {roster.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onOpenTeam?.(agent.id)}
            className="mb-1 flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-white/80"
          >
            <CatAvatar agentId={agent.id} name={agent.name} size={22} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.name}</span>
            {'model' in agent && agent.model ? (
              <span className="max-w-[7rem] truncate text-[10px] text-[var(--ink-soft)]">
                {agent.model}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  );
}
