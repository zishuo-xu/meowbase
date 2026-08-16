import { describe, expect, it } from 'vitest';
import { OpenCodeAccumulator } from '../src/providers/opencode-json.js';

describe('OpenCodeAccumulator', () => {
  it('text 增量累积;step_finish 出 usage 与 sessionId', () => {
    const acc = new OpenCodeAccumulator();
    let total = '';
    for (const line of [
      '{"type":"step_start","sessionID":"ses_fixture1","part":{"type":"step-start"}}',
      '{"type":"text","sessionID":"ses_fixture1","part":{"type":"text","text":"收"}}',
      '{"type":"text","sessionID":"ses_fixture1","part":{"type":"text","text":"到"}}',
      '{"type":"step_finish","sessionID":"ses_fixture1","part":{"type":"step-finish","reason":"stop","tokens":{"total":100,"input":6,"output":2,"cache":{"read":90}}},"cost":0.00002}',
    ]) {
      const delta = acc.push(line);
      if (delta) total += delta;
    }
    expect(total).toBe('收到');
    expect(acc.content).toBe('收到');
    expect(acc.sessionId).toBe('ses_fixture1');
    expect(acc.usage?.inputTokens).toBe(6);
    expect(acc.usage?.outputTokens).toBe(2);
    expect(acc.usage?.costUsd).toBe(0.00002);
    expect(acc.status).toBe('completed');
  });

  it('非 stop 的 step_finish 标记 failed', () => {
    const acc = new OpenCodeAccumulator();
    acc.push('{"type":"step_finish","sessionID":"s","part":{"type":"step-finish","reason":"error"}}');
    expect(acc.status).toBe('failed');
  });
});
