import { describe, expect, it } from 'vitest';
import type { MessageDto } from '../api';
import { applyStreamActivity, applyStreamIncrement, applyStreamStart, applyStreamThinking, dropAbandonedStreamShells, mergeCanonicalMessages, pipelinePhase } from '../stream-messages';

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

describe('applyStreamStart', () => {
  it('未知 messageId 新建空气泡', () => {
    const next = applyStreamStart(
      [msg({ id: 'u1', role: 'user', content: 'hi' })],
      { messageId: 'a1', agentId: 'claude' },
      't1',
    );
    expect(next[1]?.id).toBe('a1');
    expect(next[1]?.content).toBe('');
    expect(next[1]?.status).toBe('streaming');
    expect(next[1]?.agentId).toBe('claude');
  });
});

describe('applyStreamThinking', () => {
  it('思考增量单独累积,不进正文', () => {
    const first = applyStreamThinking(
      [msg({ id: 'u1', role: 'user', content: 'hi' })],
      { messageId: 'a1', delta: '先看目录', agentId: 'claude' },
      't1',
    );
    const next = applyStreamThinking(first, { messageId: 'a1', delta: '再写文件' }, 't1');
    expect(next[1]?.thinking).toBe('先看目录再写文件');
    expect(next[1]?.content).toBe('');
  });
});

describe('applyStreamActivity', () => {
  it('未知 messageId 新建气泡并挂上工具行', () => {
    const next = applyStreamActivity(
      [msg({ id: 'u1', role: 'user', content: '写 add.js' })],
      { messageId: 'a1', activity: { id: 't1', name: 'Write', arg: 'add.js', status: 'running' }, agentId: 'claude' },
      't1',
    );
    expect(next[1]?.id).toBe('a1');
    expect(next[1]?.content).toBe('');
    expect(next[1]?.status).toBe('streaming');
    expect(next[1]?.activities).toEqual([{ id: 't1', name: 'Write', arg: 'add.js', status: 'running' }]);
  });

  it('同工具 id 更新为完成', () => {
    const messages = [
      msg({
        id: 'a1',
        role: 'assistant',
        content: '',
        status: 'streaming',
        activities: [{ id: 't1', name: 'Write', arg: 'add.js', status: 'running' }],
      }),
    ];
    const next = applyStreamActivity(
      messages,
      { messageId: 'a1', activity: { id: 't1', name: 'tool', status: 'done' } },
      't1',
    );
    expect(next[0]?.activities).toEqual([{ id: 't1', name: 'Write', arg: 'add.js', status: 'done' }]);
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

  it('服务端快照无工具行时保留本地 CLI 过程', () => {
    const canonical = [msg({ id: 'a1', role: 'assistant', agentId: 'claude', content: '写好了' })];
    const streamed = [
      msg({
        id: 'a1',
        role: 'assistant',
        agentId: 'claude',
        content: '写好了',
        activities: [{ id: 't1', name: 'Write', arg: 'add.js', status: 'done' }],
      }),
    ];
    const next = mergeCanonicalMessages(canonical, streamed, 't1');
    expect(next[0]?.activities).toEqual([{ id: 't1', name: 'Write', arg: 'add.js', status: 'done' }]);
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

describe('dropAbandonedStreamShells', () => {
  it('发送中保留空气泡', () => {
    const shell = msg({ id: 'a1', role: 'assistant', content: '', status: 'streaming' });
    expect(dropAbandonedStreamShells([shell], true)).toEqual([shell]);
  });

  it('发送结束后丢掉无内容的流式空壳', () => {
    const shell = msg({ id: 'a1', role: 'assistant', content: '', status: 'streaming' });
    const done = msg({ id: 'a2', role: 'assistant', content: '写好了' });
    expect(dropAbandonedStreamShells([shell, done], false).map((m) => m.id)).toEqual(['a2']);
  });
});
