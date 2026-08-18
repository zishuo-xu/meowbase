'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type AgentConfigDto, type AppConfigDto, type EvidenceDto, type MessageDto, type ThreadDto } from '@/lib/api';
import { AGENT_ORDER, agentName, getPersona } from '@/lib/persona';
import { ThreadSidebar } from '@/components/ThreadSidebar';
import { ChatArea } from '@/components/ChatArea';
import { ChatInput } from '@/components/ChatInput';
import { TeamHub } from '@/components/TeamHub';
import { EvidenceRail } from '@/components/EvidenceRail';
import { CatAvatar } from '@/components/CatAvatar';
import { describeBall, describeRelayTimeline, formatPickupCommand } from '@/lib/ball';
import { defaultSessionTitle, isPlaceholderTitle, titleFromUserMessage } from '@/lib/threads';
import { pendingThreadIds } from '@/lib/approvals';
import { RelayTimeline } from '@/components/RelayTimeline';

const FALLBACK_AGENTS: AgentConfigDto[] = AGENT_ORDER.map((id) => ({
  id,
  name: getPersona(id).name,
  role: getPersona(id).name,
  aliases: [getPersona(id).name, id],
  bin: id,
}));

export default function Home() {
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [liveMessages, setLiveMessages] = useState<MessageDto[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfigDto | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [hubFocus, setHubFocus] = useState<string | undefined>();
  const [savingHub, setSavingHub] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceDto[]>([]);
  const [insert, setInsert] = useState<{ id: number; text: string } | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const agents = config?.agents?.length ? config.agents : FALLBACK_AGENTS;

  const refreshThreads = useCallback(async () => {
    try {
      const [list, cards] = await Promise.all([api.listThreads(), api.listApprovals()]);
      setThreads(list);
      setPendingIds(pendingThreadIds(cards));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话失败');
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api.getConfig());
    } catch {
      /* 配置拉不到时侧栏仍用内置名册 */
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
    void refreshConfig();
  }, [refreshThreads, refreshConfig]);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      const [msgs, ev] = await Promise.all([api.listMessages(id), api.listEvidence(id)]);
      setMessages(msgs);
      setLiveMessages(msgs);
      setEvidence(ev);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载消息失败');
    }
  }, []);

  const createThread = useCallback(
    async (title: string, primaryAgentId: string) => {
      try {
        const thread = await api.createThread(title, primaryAgentId);
        await refreshThreads();
        await openThread(thread.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : '新建会话失败');
      }
    },
    [openThread, refreshThreads],
  );

  const send = useCallback(
    async (content: string) => {
      if (!activeId || sending) return;
      setSending(true);
      const optimistic: MessageDto = {
        id: `local-${Date.now()}`,
        threadId: activeId,
        role: 'user',
        content,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      const nextTitle = titleFromUserMessage(content);
      if (nextTitle) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === activeId && isPlaceholderTitle(thread.title)
              ? { ...thread, title: nextTitle }
              : thread,
          ),
        );
      }
      try {
        await api.sendMessage(activeId, content);
        const [msgs, ev] = await Promise.all([
          api.listMessages(activeId),
          api.listEvidence(activeId),
        ]);
        setMessages(msgs);
        setLiveMessages(msgs);
        setEvidence(ev);
        await refreshThreads();
        setError(null);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(err instanceof Error ? err.message : '发送失败');
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, refreshThreads],
  );

  const sendCommand = useCallback(
    (content: string) => {
      void send(content);
    },
    [send],
  );

  const citeEvidence = useCallback((id: string) => {
    setInsert({ id: Date.now(), text: `#${id}` });
  }, []);

  const passBall = useCallback(
    (agentName: string) => {
      void send(formatPickupCommand(agentName));
    },
    [send],
  );

  const abortTurn = useCallback(() => {
    if (!activeId) return;
    void api.cancelTurn(activeId).catch(() => {
      /* 没有进行中的一轮时 409,忽略 */
    });
  }, [activeId]);

  const deleteThread = useCallback(
    async (id: string) => {
      if (!window.confirm('删除这个会话？消息也会一起清掉。')) return;
      try {
        await api.deleteThread(id);
        if (activeId === id) {
          setActiveId(null);
          setMessages([]);
          setLiveMessages([]);
          setEvidence([]);
        }
        await refreshThreads();
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除失败');
      }
    },
    [activeId, refreshThreads],
  );

  const openHub = (agentId?: string) => {
    setHubFocus(agentId);
    setHubOpen(true);
  };

  const headerMessages = liveMessages.length > 0 ? liveMessages : messages;

  return (
    <main className="flex h-full">
      <ThreadSidebar
        threads={threads}
        activeId={activeId}
        agents={agents}
        defaultAgentId={config?.defaultAgentId}
        onSelect={(id) => void openThread(id)}
        onCreate={(title, agent) => void createThread(title, agent)}
        onDelete={(id) => void deleteThread(id)}
        onOpenTeam={openHub}
        pendingIds={pendingIds}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)]/75 px-5 py-3 backdrop-blur-sm">
          <div>
            <h1 className="text-sm font-bold tracking-wide">meowbase · 喵窝</h1>
            <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
              {activeId
                ? describeBall(
                    headerMessages,
                    sending,
                    (id) => agentName(id, agents),
                    (id) => agents.find((a) => a.id === id)?.role,
                  ).text
                : `${agents.map((a) => a.name).join(' · ')} 就位 · 不写 @ 续上一只`}
            </p>
            {activeId ? (
              <RelayTimeline
                hops={describeRelayTimeline(headerMessages, sending, (id) => agentName(id, agents))}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1.5">
              {agents.map((agent) => (
                <CatAvatar
                  key={agent.id}
                  agentId={agent.id}
                  name={agent.name}
                  size={30}
                  title={`配置 ${agent.name}`}
                  onClick={() => openHub(agent.id)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => openHub()}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[var(--ink)] shadow-sm ring-1 ring-[var(--border)] transition hover:bg-[var(--surface)]"
            >
              团队
            </button>
          </div>
        </header>
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
            {error}
          </div>
        )}
        {activeId ? (
          <>
            <ChatArea
              threadId={activeId}
              messages={messages}
              sending={sending}
              agents={agents}
              onApprove={(id) => sendCommand(`#approve ${id}`)}
              onReject={(id, reason) => sendCommand(`#reject ${id} ${reason}`)}
              onConfirmEvidence={(id) => sendCommand(`#confirm ${id}`)}
              onCiteEvidence={citeEvidence}
              onPassBall={passBall}
              onSpeak={() => setFocusSeq((n) => n + 1)}
              onViewMessages={setLiveMessages}
            />
            <EvidenceRail
              items={evidence}
              onCite={citeEvidence}
              onConfirm={(id) => sendCommand(`#confirm ${id}`)}
            />
            <ChatInput
              sending={sending}
              agents={agents}
              insert={insert}
              onInserted={() => setInsert(null)}
              onAbort={abortTurn}
              focusSeq={focusSeq}
              onSend={(c) => void send(c)}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
            <div className="flex -space-x-2">
              {agents.map((agent) => (
                <CatAvatar
                  key={agent.id}
                  agentId={agent.id}
                  name={agent.name}
                  size={56}
                  onClick={() => openHub(agent.id)}
                />
              ))}
            </div>
            <div>
              <p className="text-base font-bold">选择或新建一个会话</p>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-[var(--ink-soft)]">
                不用点名哪只猫,不写 @ 会续上一只。说清楚要做什么,它们会自己交接。点头像可以改名字、模型和性格。
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void createThread(defaultSessionTitle(), config?.defaultAgentId ?? 'claude')
              }
              className="rounded-2xl bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[var(--accent-strong)]"
            >
              开始协作
            </button>
          </div>
        )}
      </section>
      {config ? (
        <TeamHub
          open={hubOpen}
          config={config}
          focusAgentId={hubFocus}
          saving={savingHub}
          onClose={() => setHubOpen(false)}
          onSaveAgent={(agentId, patch) => {
            setSavingHub(true);
            void api
              .patchAgent(agentId, patch)
              .then(() => refreshConfig())
              .catch((err) => setError(err instanceof Error ? err.message : '保存失败'))
              .finally(() => setSavingHub(false));
          }}
          onSaveSettings={(patch) => {
            setSavingHub(true);
            void api
              .patchConfig(patch)
              .then((next) => setConfig(next))
              .catch((err) => setError(err instanceof Error ? err.message : '保存失败'))
              .finally(() => setSavingHub(false));
          }}
          onSaveModels={(models) => {
            setSavingHub(true);
            void api
              .patchConfig({ models })
              .then((next) => setConfig(next))
              .catch((err) => setError(err instanceof Error ? err.message : '保存失败'))
              .finally(() => setSavingHub(false));
          }}
          onVerifyModel={(preset) => api.verifyModel(preset)}
        />
      ) : null}
    </main>
  );
}
