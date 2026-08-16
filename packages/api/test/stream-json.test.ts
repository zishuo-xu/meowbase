import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStreamJsonLine, StreamAccumulator } from '../src/providers/stream-json.js';

const fixture = readFileSync(
  join(import.meta.dirname, 'fixtures', 'claude-stream-json-sample.jsonl'),
  'utf8',
);

function resultLine(): Record<string, unknown> {
  const line = fixture.split('\n').find((l) => l.includes('"type":"result"'));
  if (!line) throw new Error('fixture 缺少 result 行');
  return JSON.parse(line) as Record<string, unknown>;
}

describe('parseStreamJsonLine', () => {
  it('解析 assistant 思考块,不混进正文', () => {
    const event = parseStreamJsonLine(
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"先写测试再实现"}]},"session_id":"s1"}',
    );
    expect(event?.thinkingDelta).toBe('先写测试再实现');
    expect(event?.textDelta).toBe('');
  });

  it('解析 assistant 增量文本', () => {
    const event = parseStreamJsonLine(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"你好"}]},"session_id":"s1"}',
    );
    expect(event?.textDelta).toBe('你好');
    expect(event?.sessionId).toBe('s1');
  });

  it('解析 result 事件(含 usage 与 cost)', () => {
    const event = parseStreamJsonLine(
      '{"type":"result","subtype":"success","result":"全文","session_id":"s1","total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":3,"cache_read_input_tokens":5}}',
    );
    expect(event?.resultText).toBe('全文');
    expect(event?.usage?.inputTokens).toBe(10);
    expect(event?.usage?.cacheReadTokens).toBe(5);
    expect(event?.usage?.costUsd).toBe(0.01);
  });

  it('空行/非 JSON 返回 null', () => {
    expect(parseStreamJsonLine('')).toBeNull();
    expect(parseStreamJsonLine('not json')).toBeNull();
  });
});

describe('StreamAccumulator', () => {
  it('真实 fixture:增量累积 + result 覆盖全文', () => {
    const acc = new StreamAccumulator();
    for (const line of fixture.split('\n')) acc.push(line);

    const result = resultLine();
    const usage = result.usage as Record<string, unknown>;
    expect(acc.content).toBe(result.result);
    expect(acc.content.length).toBeGreaterThan(0);
    expect(acc.sessionId).toBe(result.session_id);
    expect(acc.usage?.inputTokens).toBe(usage.input_tokens);
    expect(acc.usage?.cacheReadTokens).toBe(usage.cache_read_input_tokens);
    expect(acc.usage?.costUsd).toBe(result.total_cost_usd);
    expect(acc.status).toBe('completed');
  });

  it('is_error 标记为 failed', () => {
    const acc = new StreamAccumulator();
    acc.push('{"type":"result","subtype":"error_max_turns","is_error":true,"result":"x","session_id":"s"}');
    expect(acc.status).toBe('failed');
    expect(acc.error).toBe('error_max_turns');
  });

  it('thinking_tokens 不进入 CLI 工具列表', () => {
    const acc = new StreamAccumulator();
    acc.push('{"type":"system","subtype":"thinking_tokens","session_id":"s","estimated_tokens":3}');
    expect(acc.takeActivities()).toEqual([]);
    expect(acc.takeThinking()).toBeNull();
  });

  it('thinking 块进入 takeThinking', () => {
    const acc = new StreamAccumulator();
    acc.push(
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"先看目录"}]},"session_id":"s"}',
    );
    acc.push(
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"再写文件"}]},"session_id":"s"}',
    );
    expect(acc.takeThinking()).toBe('先看目录再写文件');
    expect(acc.takeThinking()).toBeNull();
  });

  it('tool_use 行进入 takeActivities', () => {
    const acc = new StreamAccumulator();
    acc.push(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.ts"}}]},"session_id":"s"}',
    );
    expect(acc.takeActivities()).toEqual([{ id: 't1', name: 'Read', arg: 'a.ts', status: 'running' }]);
    expect(acc.takeActivities()).toEqual([]);
  });
});
