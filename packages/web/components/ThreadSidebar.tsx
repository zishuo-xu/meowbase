'use client';
import { useState } from 'react';
import type { AgentConfigDto, ThreadDto } from '@/lib/api';
import { AGENT_ORDER, agentName, getPersona } from '@/lib/persona';
import { defaultSessionTitle, isNoiseThreadTitle, sortThreadsByCreated, threadRepoHint } from '@/lib/threads';
import { CatAvatar } from './CatAvatar';

function ThreadRow({
  thread,
  active,
  pending,
  agents,
  onSelect,
  onDelete,
}: {
  thread: ThreadDto;
  active: boolean;
  pending?: boolean;
  agents?: AgentConfigDto[];
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div
      className={`mb-1 flex w-full items-stretch rounded-2xl transition ${
        active
          ? 'bg-[var(--accent)]/10 shadow-sm ring-1 ring-[var(--accent)]/30'
          : 'hover:bg-black/5'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(thread.id)}
        className="min-w-0 flex-1 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 truncate text-sm font-medium">{thread.title}</div>
          {pending ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
              待确认
            </span>
          ) : null}
        </div>
        {thread.repo ? (
          <div className="mt-0.5 truncate text-[10px] text-[var(--ink-soft)]">
            {threadRepoHint(thread.repo)}
          </div>
        ) : null}
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
      {onDelete ? (
        <button
          type="button"
          aria-label={`删除 ${thread.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(thread.id);
          }}
          className="shrink-0 px-2 text-xs text-[var(--ink-soft)] hover:text-red-600"
        >
          删
        </button>
      ) : null}
    </div>
  );
}

export function ThreadSidebar({
  threads,
  activeId,
  agents,
  defaultAgentId,
  onSelect,
  onCreate,
  onDelete,
  onOpenTeam,
  pendingIds,
}: {
  threads: ThreadDto[];
  activeId: string | null;
  agents?: AgentConfigDto[];
  defaultAgentId?: string;
  onSelect: (id: string) => void;
  onCreate: (
    title: string,
    primaryAgentId: string,
    opts?: { repoPath?: string; baseBranch?: string },
  ) => void;
  onDelete?: (id: string) => void;
  onOpenTeam?: (agentId?: string) => void;
  pendingIds?: readonly string[];
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
  const [showNoise, setShowNoise] = useState(false);
  const [repoPath, setRepoPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const ordered = sortThreadsByCreated(threads);
  const visible = ordered.filter((t) => !isNoiseThreadTitle(t.title));
  const noise = ordered.filter((t) => isNoiseThreadTitle(t.title));
  const pending = new Set(pendingIds ?? []);

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
        <input
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="仓库路径（可选）"
          className="mb-1.5 w-full rounded-xl border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-soft)]"
        />
        <input
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          placeholder="基准分支（可选）"
          className="mb-2 w-full rounded-xl border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-soft)]"
        />
        <button
          onClick={() => {
            const path = repoPath.trim();
            const branch = baseBranch.trim();
            const opts =
              path || branch
                ? { ...(path ? { repoPath: path } : {}), ...(branch ? { baseBranch: branch } : {}) }
                : undefined;
            onCreate(defaultSessionTitle(), primary, opts);
          }}
          className="w-full rounded-2xl bg-[var(--accent)] px-3 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--accent-strong)]"
        >
          + 新会话
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {visible.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            active={thread.id === activeId}
            pending={pending.has(thread.id)}
            agents={agents}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
        {noise.length > 0 && (
          <div className="mt-2 px-1">
            <button
              type="button"
              onClick={() => setShowNoise((v) => !v)}
              className="w-full text-left text-[11px] text-[var(--ink-soft)] hover:underline"
            >
              {showNoise ? '收起' : '展开'} {noise.length} 条测试残留
            </button>
            {showNoise &&
              noise.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeId}
                  pending={pending.has(thread.id)}
                  agents={agents}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
              ))}
          </div>
        )}
        {visible.length === 0 && noise.length === 0 && (
          <div className="px-3 py-10 text-center text-xs leading-relaxed text-[var(--ink-soft)]">
            还没有会话
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
