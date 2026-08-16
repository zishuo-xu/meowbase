import { describe, expect, it } from 'vitest';
import type { MessageDto } from '../api';
import { applyStreamIncrement, mergeCanonicalMessages, pipelinePhase } from '../stream-messages';

function msg(partial: Partial<MessageDto> & Pick<MessageDto, 'id' | 'role' | 'content'>): MessageDto {
  return {
    threadId: 't1',
    status: 'completed',
    createdAt: '',
    ...partial,
  };
}

describe('applyStreamIncrement', () => {
  it('已有消息则追加 delta', () => {
    const messages = [msg({ id: 'a1', role: 'assistant', agentId: 'claude', content: '你' })];
    const next = applyStreamIncrement(messages, { messageId: 'a1', delta: '好' }, 't1');
    expect(next[0]?.content).toBe('你好');
    expect(next[0]?.status).toBe('streaming');
  });

  it('未知 messageId 新建 assistant 气泡,不丢增量', () => {
    const next = applyStreamIncrement(
      [msg({ id: 'u1', role: 'user', content: 'hi' })],
      { messageId: 'a2', delta: '墨墨来了', agentId: 'claude' },
      't1',
    );
    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe('a2');
    expect(next[1]?.role).toBe('assistant');
    expect(next[1]?.agentId).toBe('claude');
    expect(next[1]?.content).toBe('墨墨来了');
    expect(next[1]?.status).toBe('streaming');
  });
});

describe('mergeCanonicalMessages', () => {
  it('同 id 保留更长的流式正文', () => {
    const canonical = [
      msg({ id: 'a1', role: 'assistant', agentId: 'claude', content: '', status: 'streaming' }),
    ];
    const streamed = [
      msg({ id: 'a1', role: 'assistant', agentId: 'claude', content: '你好', status: 'streaming' }),
    ];
    const next = mergeCanonicalMessages(canonical, streamed, 't1');
    expect(next[0]?.content).toBe('你好');
    expect(next[0]?.status).toBe('streaming');
  });

  it('服务端用户消息到位后丢掉 local- 乐观气泡', () => {
    const canonical = [msg({ id: 'u-real', role: 'user', content: '干活' })];
    const streamed = [msg({ id: 'local-1', role: 'user', content: '干活' })];
    const next = mergeCanonicalMessages(canonical, streamed, 't1');
    expect(next.map((m) => m.id)).toEqual(['u-real']);
  });

  it('WS 抢先到达的 assistant 在快照里还没有时予以保留', () => {
    const canonical = [msg({ id: 'u1', role: 'user', content: 'hi' })];
    const streamed = [
      msg({ id: 'u1', role: 'user', content: 'hi' }),
      msg({ id: 'a2', role: 'assistant', agentId: 'claude', content: '墨', status: 'streaming' }),
    ];
    const next = mergeCanonicalMessages(canonical, streamed, 't1');
    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe('a2');
    expect(next[1]?.content).toBe('墨');
  });
});

describe('pipelinePhase', () => {
  it('未发送时为空闲', () => {
    expect(pipelinePhase([msg({ id: 'u1', role: 'user', content: 'hi' })], false)).toBe('idle');
  });

  it('发送中且写手尚未完成时为干活', () => {
    expect(
      pipelinePhase(
        [
          msg({ id: 'u1', role: 'user', content: '写 add.js' }),
          msg({ id: 'a1', role: 'assistant', content: '正在', status: 'streaming' }),
        ],
        true,
      ),
    ).toBe('working');
  });

  it('发送中且写手已完成时为审查', () => {
    expect(
      pipelinePhase(
        [
          msg({ id: 'u1', role: 'user', content: '写 add.js' }),
          msg({ id: 'a1', role: 'assistant', content: '写好了', status: 'completed' }),
        ],
        true,
      ),
    ).toBe('reviewing');
  });
});
