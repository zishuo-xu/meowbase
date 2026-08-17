'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type AgentConfigDto, type ApprovalDto, type MessageDto } from '@/lib/api';
import { MessageBubble } from './MessageBubble';
import { useThreadStream } from '@/lib/use-thread-stream';
import { applyStreamActivity, applyStreamIncrement, applyStreamStart, applyStreamThinking, dropAbandonedStreamShells, mergeCanonicalMessages, pipelinePhase } from '@/lib/stream-messages';
import { agentName } from '@/lib/persona';
import { approvalStatusFromDto, isHiddenChatMessage, parseMessage } from '@/lib/parse-message';

export function ChatArea({
  threadId,
  messages,
  sending,
  agents,
  onApprove,
  onReject,
  onConfirmEvidence,
  onCiteEvidence,
  onPassBall,
  onSpeak,
}: {
  threadId: string;
  messages: MessageDto[];
  sending?: boolean;
  agents?: AgentConfigDto[];
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onConfirmEvidence: (id: string) => void;
  onCiteEvidence?: (id: string) => void;
  onPassBall?: (agentName: string) => void;
  onSpeak?: () => void;
}) {
  const { lastEvent } = useThreadStream(threadId);
  const [streamed, setStreamed] = useState<MessageDto[]>(messages);
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStreamed((prev) => mergeCanonicalMessages(messages, prev, threadId));
  }, [messages, threadId]);
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'activity') {
      setStreamed((prev) => applyStreamActivity(prev, lastEvent, threadId));
      return;
    }
    if (lastEvent.type === 'start') {
      setStreamed((prev) => applyStreamStart(prev, lastEvent, threadId));
      return;
    }
    if (lastEvent.type === 'thinking') {
      setStreamed((prev) => applyStreamThinking(prev, lastEvent, threadId));
      return;
    }
    if (lastEvent.type !== 'increment') return;
    setStreamed((prev) => applyStreamIncrement(prev, lastEvent, threadId));
  }, [lastEvent, threadId]);
  useEffect(() => {
    let cancelled = false;
    void api
      .listApprovals(threadId)
      .then((list) => {
        if (!cancelled) setApprovals(list);
      })
      .catch(() => {
        if (!cancelled) setApprovals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, messages]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamed]);

  const phase = pipelinePhase(streamed, Boolean(sending));
  const approvalById = new Map(approvals.map((card) => [card.id, card]));
  const visible = dropAbandonedStreamShells(streamed, Boolean(sending)).filter(
    (m) => !isHiddenChatMessage(m),
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-3">
        {visible.map((m) => {
          const parsed = parseMessage(m);
          const card = parsed.approvalId ? approvalById.get(parsed.approvalId) : undefined;
          const writerId = card?.writerAgentId ?? parsed.writerId;
          const reviewerId = card?.reviewerAgentId ?? parsed.reviewerId;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              agentName={agentName(m.agentId, agents)}
              writerName={writerId ? agentName(writerId, agents) : undefined}
              reviewerName={reviewerId ? agentName(reviewerId, agents) : undefined}
              approvalStatus={approvalStatusFromDto(card?.status) ?? parsed.approvalStatus}
              diffText={card?.diffText}
              onApprove={onApprove}
              onReject={onReject}
              onConfirmEvidence={onConfirmEvidence}
              onCiteEvidence={onCiteEvidence}
              agents={agents}
              onPassBall={onPassBall}
              onSpeak={onSpeak}
            />
          );
        })}
        {phase !== 'idle' && (
          <div className="px-4 py-2 text-xs text-[var(--ink-soft)]">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 ring-1 ring-[var(--border)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              {phase === 'reviewing' ? '猫们正在互审，通过才会交给你…' : '猫们正在干活…'}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
