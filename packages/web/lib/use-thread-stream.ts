'use client';
import { useEffect, useState } from 'react';
import { baseUrl, type ToolActivity } from './api';

export type StreamEvent =
  | { type: 'increment'; messageId: string; delta: string; agentId?: string }
  | { type: 'activity'; messageId: string; activity: ToolActivity; agentId?: string }
  | { type: 'start'; messageId: string; agentId?: string }
  | { type: 'thinking'; messageId: string; delta: string; agentId?: string };

export function useThreadStream(threadId: string | null): {
  lastEvent: StreamEvent | null;
} {
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);

  useEffect(() => {
    if (!threadId) return;
    const ws = new WebSocket(
      `${baseUrl.replace(/^http/, 'ws')}/api/ws?threadId=${threadId}`,
    );
    ws.onmessage = (event) => {
      try {
        setLastEvent(JSON.parse(event.data as string) as StreamEvent);
      } catch {
        // 忽略无法解析的帧
      }
    };
    return () => ws.close();
  }, [threadId]);

  return { lastEvent };
}
