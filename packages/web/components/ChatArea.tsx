'use client';
import { useEffect, useRef, useState } from 'react';
import type { AgentConfigDto, MessageDto } from '@/lib/api';
import { MessageBubble } from './MessageBubble';
import { useThreadStream } from '@/lib/use-thread-stream';
import { applyStreamIncrement, mergeCanonicalMessages } from '@/lib/stream-messages';
import { agentName } from '@/lib/persona';

export function ChatArea({
  threadId,
  messages,
  sending,
  agents,
  onApprove,
  onReject,
  onConfirmEvidence,
}: {
  threadId: string;
  messages: MessageDto[];
  sending?: boolean;
  agents?: AgentConfigDto[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onConfirmEvidence: (id: string) => void;
}) {
  const { lastEvent } = useThreadStream(threadId);
  const [streamed, setStreamed] = useState<MessageDto[]>(messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStreamed((prev) => mergeCanonicalMessages(messages, prev, threadId));
  }, [messages, threadId]);
  useEffect(() => {
    if (!lastEvent) return;
    setStreamed((prev) => applyStreamIncrement(prev, lastEvent, threadId));
  }, [lastEvent, threadId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamed]);

  const waiting = Boolean(sending) && streamed.every((m) => m.status !== 'streaming');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-3">
        {streamed.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            agentName={agentName(m.agentId, agents)}
            onApprove={onApprove}
            onReject={onReject}
            onConfirmEvidence={onConfirmEvidence}
          />
        ))}
        {waiting && (
          <div className="px-4 py-2 text-xs text-[var(--ink-soft)]">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 ring-1 ring-[var(--border)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              猫们正在干活…
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
