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
});
