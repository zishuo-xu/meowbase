import { describe, expect, it } from 'vitest';
import { classifyTool, sumToolUsage } from '../src/tool-usage.js';
import type { Message } from '../src/types.js';

function msg(partial: Pick<Message, 'role' | 'status'> & Partial<Message>): Message {
  return {
    id: partial.id ?? 'm',
    threadId: partial.threadId ?? 't',
    content: partial.content ?? '',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('classifyTool', () => {
  it('mcp__ 和 mcp: 归 mcp,skill 前缀归 skill,其余 builtin;思考不算', () => {
    expect(classifyTool('mcp__github__search')).toBe('mcp');
    expect(classifyTool('mcp:fs/read')).toBe('mcp');
    expect(classifyTool('Skill')).toBe('skill');
    expect(classifyTool('skill:tdd')).toBe('skill');
    expect(classifyTool('skill__review')).toBe('skill');
    expect(classifyTool('Write')).toBe('builtin');
    expect(classifyTool('思考')).toBeNull();
    expect(classifyTool('')).toBeNull();
  });
});

describe('sumToolUsage', () => {
  it('只算完成的助手消息;技能按 id,工具按名,思考跳过', () => {
    const result = sumToolUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        skillIds: ['review', 'quality-gate'],
        activities: [
          { id: 't1', name: 'Write', status: 'done' },
          { id: 't2', name: '思考', status: 'done' },
          { id: 't3', name: 'mcp__github__search', status: 'done' },
        ],
      }),
      msg({
        role: 'assistant',
        status: 'streaming',
        agentId: 'claude',
        skillIds: ['tdd'],
        activities: [{ id: 't9', name: 'Write', status: 'running' }],
      }),
      msg({
        role: 'user',
        status: 'completed',
        skillIds: ['review'],
        activities: [{ id: 'u', name: 'Write', status: 'done' }],
      }),
    ]);
    expect(result.skills).toEqual([
      { id: 'quality-gate', count: 1 },
      { id: 'review', count: 1 },
    ]);
    expect(result.tools).toEqual([
      { name: 'Write', category: 'builtin', count: 1 },
      { name: 'mcp__github__search', category: 'mcp', count: 1 },
    ]);
    expect(result.total).toEqual({ skillInjections: 2, toolCalls: 2 });
  });

  it('同名工具和同 id 技能累加,按次数降序', () => {
    const result = sumToolUsage([
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'claude',
        skillIds: ['review'],
        activities: [{ id: 'a', name: 'Write', status: 'done' }],
      }),
      msg({
        role: 'assistant',
        status: 'completed',
        agentId: 'gemini',
        skillIds: ['review', 'tdd'],
        activities: [
          { id: 'b', name: 'Write', status: 'done' },
          { id: 'c', name: 'Write', status: 'error' },
        ],
      }),
    ]);
    expect(result.skills[0]).toEqual({ id: 'review', count: 2 });
    expect(result.skills[1]).toEqual({ id: 'tdd', count: 1 });
    expect(result.tools).toEqual([{ name: 'Write', category: 'builtin', count: 3 }]);
    expect(result.total).toEqual({ skillInjections: 3, toolCalls: 3 });
  });

  it('没有记录时空表,不写 0', () => {
    expect(sumToolUsage([])).toEqual({
      skills: [],
      tools: [],
      total: { skillInjections: 0, toolCalls: 0 },
    });
  });
});
