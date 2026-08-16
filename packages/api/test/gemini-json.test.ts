import { describe, expect, it } from 'vitest';
import { GeminiAccumulator } from '../src/providers/gemini-json.js';

describe('GeminiAccumulator', () => {
  it('assistant delta 累积;init 出 sessionId;result 出 usage', () => {
    const acc = new GeminiAccumulator();
    let total = '';
    for (const line of [
      '{"type":"init","session_id":"sess-g1","model":"gemini-2.0-flash"}',
      '{"type":"message","role":"user","content":"你好"}',
      '{"type":"message","role":"assistant","content":"你","delta":true}',
      '{"type":"message","role":"assistant","content":"好","delta":true}',
      '{"type":"result","status":"success","stats":{"total_tokens":13,"input_tokens":10,"output_tokens":3,"cached":2,"duration_ms":1200,"tool_calls":0}}',
    ]) {
      const delta = acc.push(line);
      if (delta) total += delta;
    }
    expect(total).toBe('你好');
    expect(acc.content).toBe('你好');
    expect(acc.sessionId).toBe('sess-g1');
    expect(acc.usage?.inputTokens).toBe(10);
    expect(acc.usage?.outputTokens).toBe(3);
    expect(acc.usage?.totalTokens).toBe(13);
    expect(acc.usage?.cacheReadTokens).toBe(2);
    expect(acc.status).toBe('completed');
  });

  it('无 delta 的 assistant 全文当一次增量', () => {
    const acc = new GeminiAccumulator();
    const delta = acc.push('{"type":"message","role":"assistant","content":"全文"}');
    expect(delta).toBe('全文');
    expect(acc.content).toBe('全文');
  });

  it('已有 delta 后再来全文快照不重复累积', () => {
    const acc = new GeminiAccumulator();
    acc.push('{"type":"message","role":"assistant","content":"你好","delta":true}');
    const extra = acc.push('{"type":"message","role":"assistant","content":"你好"}');
    expect(extra).toBeNull();
    expect(acc.content).toBe('你好');
  });

  it('result status=error 标记 failed', () => {
    const acc = new GeminiAccumulator();
    acc.push(
      '{"type":"result","status":"error","error":{"type":"api","message":"quota exceeded"}}',
    );
    expect(acc.status).toBe('failed');
    expect(acc.error).toBe('quota exceeded');
  });

  it('中间 tool_use 不算失败', () => {
    const acc = new GeminiAccumulator();
    acc.push('{"type":"init","session_id":"s"}');
    acc.push('{"type":"tool_use","tool_name":"write_file","tool_id":"t1"}');
    acc.push('{"type":"tool_result","tool_id":"t1","status":"success"}');
    acc.push('{"type":"message","role":"assistant","content":"写好了","delta":true}');
    acc.push(
      '{"type":"result","status":"success","stats":{"total_tokens":10,"input_tokens":5,"output_tokens":3,"cached":0}}',
    );
    expect(acc.status).toBe('completed');
    expect(acc.content).toBe('写好了');
  });

  it('tool_use 进入 takeActivities', () => {
    const acc = new GeminiAccumulator();
    acc.push('{"type":"tool_use","tool_name":"write_file","tool_id":"t1"}');
    expect(acc.takeActivities()).toEqual([{ id: 't1', name: 'write_file', status: 'running' }]);
  });

  it('空行/非 JSON 返回 null', () => {
    const acc = new GeminiAccumulator();
    expect(acc.push('')).toBeNull();
    expect(acc.push('not json')).toBeNull();
  });
});
