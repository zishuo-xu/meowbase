'use client';
import { useEffect, useRef, useState } from 'react';
import type { MessageDto } from '@/lib/api';
import { MessageBubble } from './MessageBubble';
import { useThreadStream } from '@/lib/use-thread-stream';

export function ChatArea({
  threadId,
  messages,
  onApprove,
  onReject,
  onConfirmEvidence,
}: {
  threadId: string;
  messages: MessageDto[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onConfirmEvidence: (id: string) => void;
}) {
  const { lastEvent } = useThreadStream(threadId);
  const [streamed, setStreamed] = useState<MessageDto[]>(messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => setStreamed(messages), [messages]);
  useEffect(() => {
    if (!lastEvent) return;
    setStreamed((prev) => {
      const idx = prev.findIndex((m) => m.id === lastEvent.messageId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], content: next[idx].content + lastEvent.delta };
      return next;
    });
  }, [lastEvent]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamed]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-3">
        {streamed.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onApprove={onApprove}
            onReject={onReject}
            onConfirmEvidence={onConfirmEvidence}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
