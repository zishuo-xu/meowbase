import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { closeThreadSocket, useThreadStream, type StreamEvent } from '../use-thread-stream';

class FakeSocket {
  readyState = FakeSocket.CONNECTING;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
  });
  addEventListener = vi.fn((type: string, fn: () => void) => {
    if (type === 'open') this.onOpen = fn;
  });
  onOpen: (() => void) | null = null;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
}

describe('useThreadStream', () => {
  const sockets: FakeSocket[] = [];

  afterEach(() => {
    sockets.length = 0;
    vi.unstubAllGlobals();
  });

  function stubSocket() {
    vi.stubGlobal(
      'WebSocket',
      class {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        constructor() {
          const sock = new FakeSocket();
          sockets.push(sock);
          return sock;
        }
      },
    );
  }

  it('认 sync 事件', () => {
    stubSocket();
    const { result } = renderHook(() => useThreadStream('t1'));
    const sock = sockets[0];
    expect(sock).toBeTruthy();
    act(() => {
      sock!.onmessage?.({ data: JSON.stringify({ type: 'sync', threadId: 't1' }) });
    });
    expect((result.current.lastEvent as StreamEvent | null)?.type).toBe('sync');
  });

  it('关 socket 前先看连接状态,CONNECTING 时不立刻 close', () => {
    const sock = new FakeSocket();
    closeThreadSocket(sock);
    expect(sock.close).not.toHaveBeenCalled();
    sock.readyState = FakeSocket.OPEN;
    closeThreadSocket(sock);
    expect(sock.close).toHaveBeenCalledTimes(1);
  });
});
