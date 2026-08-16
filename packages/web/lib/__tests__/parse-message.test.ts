import { describe, expect, it } from 'vitest';
import { parseMessage } from '../parse-message';

describe('parseMessage', () => {
  it('📋 审批卡片 → approval 块', () => {
    const parsed = parseMessage({
      role: 'system',
      content:
        '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:opencode)\n改动:x.txt\n审查意见:通过\n回复 #approve ap_a1b2c3d4 批准',
    });
    expect(parsed.kind).toBe('approval');
    expect(parsed.approvalId).toBe('ap_a1b2c3d4');
    expect(parsed.stat).toContain('x.txt');
    expect(parsed.comment).toContain('通过');
  });

  it('💡 建议 → evidence 块', () => {
    const parsed = parseMessage({
      role: 'system',
      content: '💡 建议沉淀为证据:「标题」\n回复 #confirm ev_a1b2c3d4 确认',
    });
    expect(parsed.kind).toBe('evidence');
    expect(parsed.evidenceId).toBe('ev_a1b2c3d4');
    expect(parsed.title).toBe('标题');
  });

  it('✅/⛔/⚠️ 回执 → receipt', () => {
    expect(parseMessage({ role: 'system', content: '✅ 已沉淀:标题' }).kind).toBe('receipt');
    expect(parseMessage({ role: 'system', content: '普通系统消息' }).kind).toBe('text');
  });

  it('user/assistant 消息 → text', () => {
    expect(parseMessage({ role: 'user', content: 'hi' }).kind).toBe('text');
    expect(parseMessage({ role: 'assistant', content: 'hello' }).kind).toBe('text');
  });
});
