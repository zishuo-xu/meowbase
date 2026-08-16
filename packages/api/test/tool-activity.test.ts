import { describe, expect, it } from 'vitest';
import { extractToolActivities, upsertToolActivity } from '../src/providers/tool-activity.js';

describe('extractToolActivities', () => {
  it('Claude assistant tool_use → running + 主参数', () => {
    const events = extractToolActivities({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Write',
            input: { file_path: 'add.js', content: 'export function add() {}' },
          },
        ],
      },
    });
    expect(events).toEqual([{ id: 'toolu_1', name: 'Write', arg: 'add.js', status: 'running' }]);
  });

  it('Claude user tool_result → done', () => {
    const events = extractToolActivities({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Wrote add.js' }],
      },
    });
    expect(events).toEqual([{ id: 'toolu_1', name: 'tool', status: 'done' }]);
  });

  it('Gemini tool_use / tool_result', () => {
    expect(
      extractToolActivities({ type: 'tool_use', tool_name: 'write_file', tool_id: 't1' }),
    ).toEqual([{ id: 't1', name: 'write_file', status: 'running' }]);
    expect(
      extractToolActivities({ type: 'tool_result', tool_id: 't1', status: 'success' }),
    ).toEqual([{ id: 't1', name: 'tool', status: 'done' }]);
  });

  it('OpenCode part.type=tool 用 state.status', () => {
    expect(
      extractToolActivities({
        type: 'tool',
        sessionID: 's',
        part: {
          type: 'tool',
          id: 'call_1',
          tool: 'write',
          state: { status: 'running', input: { path: 'add.js' } },
        },
      }),
    ).toEqual([{ id: 'call_1', name: 'write', arg: 'add.js', status: 'running' }]);
    expect(
      extractToolActivities({
        type: 'tool',
        part: {
          type: 'tool',
          id: 'call_1',
          tool: 'write',
          state: { status: 'completed', input: { path: 'add.js' } },
        },
      }),
    ).toEqual([{ id: 'call_1', name: 'write', arg: 'add.js', status: 'done' }]);
  });

  it('纯文本不产出活动', () => {
    expect(extractToolActivities({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })).toEqual(
      [],
    );
  });
});

describe('upsertToolActivity', () => {
  it('同 id 合并:保留原 name,更新 status', () => {
    const first = upsertToolActivity([], { id: 't1', name: 'Write', arg: 'add.js', status: 'running' });
    const next = upsertToolActivity(first, { id: 't1', name: 'tool', status: 'done' });
    expect(next).toEqual([{ id: 't1', name: 'Write', arg: 'add.js', status: 'done' }]);
  });
});
