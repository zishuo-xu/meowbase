'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type MessageDto, type ThreadDto } from '@/lib/api';
import { ThreadSidebar } from '@/components/ThreadSidebar';
import { ChatArea } from '@/components/ChatArea';
import { ChatInput } from '@/components/ChatInput';

export default function Home() {
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await api.listThreads());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载线程失败');
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      setMessages(await api.listMessages(id));
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
        setError(err instanceof Error ? err.message : '新建线程失败');
      }
    },
    [openThread, refreshThreads],
  );

  const send = useCallback(
    async (content: string) => {
      if (!activeId || sending) return;
      setSending(true);
      try {
        await api.sendMessage(activeId, content);
        // 重新拉取完整消息列表:含用户消息、回复与系统卡片/建议消息
        setMessages(await api.listMessages(activeId));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发送失败');
      } finally {
        setSending(false);
      }
    },
    [activeId, sending],
  );

  const sendCommand = useCallback(
    (content: string) => {
      void send(content);
    },
    [send],
  );

  return (
    <main className="flex h-full">
      <ThreadSidebar
        threads={threads}
        activeId={activeId}
        onSelect={(id) => void openThread(id)}
        onCreate={(title, agent) => void createThread(title, agent)}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-white/60 px-4 py-2">
          <h1 className="text-sm font-bold">meowbase · 喵窝</h1>
          <span className="text-xs text-[var(--ink-soft)]">墨墨 · 闪闪 · 团团 就位</span>
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
              onApprove={(id) => sendCommand(`#approve ${id}`)}
              onReject={(id) => sendCommand(`#reject ${id} 打回`)}
              onConfirmEvidence={(id) => sendCommand(`#confirm ${id}`)}
            />
            <ChatInput onSend={(c) => void send(c)} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--ink-soft)]">
            选择或新建一个线程,和猫们开始协作
          </div>
        )}
      </section>
    </main>
  );
}
