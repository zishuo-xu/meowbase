import { describe, expect, it } from 'vitest';
import { approvalCardTitle, isHiddenChatMessage, parseMessage } from '../parse-message';

describe('parseMessage', () => {
  it('📋 审批卡片 → approval 块', () => {
    const parsed = parseMessage({
      role: 'system',
      content:
        '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:opencode)\n改动:x.txt | 1 +\n审查意见:通过\n回复 #approve ap_a1b2c3d4 批准',
    });
    expect(parsed.kind).toBe('approval');
    expect(parsed.approvalId).toBe('ap_a1b2c3d4');
    expect(parsed.writerId).toBe('claude');
    expect(parsed.reviewerId).toBe('opencode');
    expect(parsed.stat).toContain('x.txt');
    expect(parsed.comment).toContain('通过');
    expect(parsed.approvalStatus).toBe('pending');
  });

  it('审查意见可多行,不截在第一行', () => {
    const parsed = parseMessage({
      role: 'system',
      content:
        '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:opencode)\n改动:a.ts | 3 +\n审查意见:## 代码审查\n- 没问题\n结论:通过\n回复 #approve ap_a1b2c3d4 批准',
    });
    expect(parsed.comment).toContain('没问题');
    expect(parsed.comment).toContain('结论:通过');
    expect(parsed.comment).not.toContain('#approve');
  });

  it('自动批准卡片解析为已落地', () => {
    const parsed = parseMessage({
      role: 'system',
      content:
        '🤖 审批卡片 ap_a1b2c3d4(写:claude → 审:opencode)\n改动:x.txt\n审查意见:通过\n✅ 已自动批准(autoApprove)',
    });
    expect(parsed.kind).toBe('approval');
    expect(parsed.approvalStatus).toBe('applied');
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

  it('git-move 不崩,提交句当普通系统正文,越界句当回执', () => {
    expect(
      parseMessage({
        role: 'system',
        systemKind: 'git-move',
        content: '墨墨 在 `meow/xxx` 上提交了 1 个 commit',
      }),
    ).toEqual({ kind: 'text', text: '墨墨 在 `meow/xxx` 上提交了 1 个 commit' });
    expect(
      parseMessage({
        role: 'system',
        systemKind: 'git-overstep',
        content: '⚠️ 基准分支 `main` 的远端引用变了',
      }).kind,
    ).toBe('receipt');
  });

  it('user/assistant 消息 → text', () => {
    expect(parseMessage({ role: 'user', content: 'hi' }).kind).toBe('text');
    expect(parseMessage({ role: 'assistant', content: 'hello' }).kind).toBe('text');
  });

  it('有 approval-pending kind 时改掉卡片套话仍解析为待确认', () => {
    const parsed = parseMessage({
      role: 'system',
      systemKind: 'approval-pending',
      content:
        '卡片 ap_a1b2c3d4(写:claude → 审:opencode)\n改动:x.txt | 1 +\n审查意见:通过\n回复 #approve ap_a1b2c3d4 批准',
    });
    expect(parsed.kind).toBe('approval');
    expect(parsed.approvalId).toBe('ap_a1b2c3d4');
    expect(parsed.approvalStatus).toBe('pending');
  });
});

describe('isHiddenChatMessage', () => {
  it('隐藏点卡片产生的协议指令和落地回执', () => {
    expect(isHiddenChatMessage({ role: 'user', content: '#approve ap_a1b2c3d4' })).toBe(true);
    expect(isHiddenChatMessage({ role: 'user', content: '#reject ap_a1b2c3d4 打回' })).toBe(true);
    expect(isHiddenChatMessage({ role: 'system', content: '✅ 已批准并落地: ap_a1b2c3d4' })).toBe(true);
    expect(isHiddenChatMessage({ role: 'system', content: '⛔ 已打回:ap_a1b2c3d4 理由:打回' })).toBe(true);
    expect(isHiddenChatMessage({ role: 'user', content: '@墨墨 继续' })).toBe(false);
    expect(isHiddenChatMessage({ role: 'system', content: '✅ 已沉淀:标题' })).toBe(false);
  });
});

describe('approvalCardTitle', () => {
  it('按状态和审查结论写标题,不再一律待确认', () => {
    expect(approvalCardTitle('pending', '结论:通过')).toBe('审查通过，待你确认');
    expect(approvalCardTitle('pending', '## 结论\n需修改')).toBe('互审未通过，待你决定');
    expect(approvalCardTitle('applied', '通过')).toBe('改动已确认');
    expect(approvalCardTitle('rejected', '需修改')).toBe('已打回');
  });

  it('verdict=pass → 审查通过，待你确认', () => {
    expect(approvalCardTitle('pending', '结论:需修改', 'pass')).toBe('审查通过，待你确认');
  });

  it('verdict=revise → 互审未通过，待你决定', () => {
    expect(approvalCardTitle('pending', '结论:通过', 'revise')).toBe('互审未通过，待你决定');
  });

  it('verdict=incomplete → 缺验证证据，标题不含通过', () => {
    const title = approvalCardTitle('pending', '结论:通过', 'incomplete');
    expect(title).toBe('缺验证证据，待你决定');
    expect(title).not.toContain('通过');
  });

  it('verdict 缺失时仍按正文判断(老消息)', () => {
    expect(approvalCardTitle('pending', '结论:通过')).toBe('审查通过，待你确认');
    expect(approvalCardTitle('pending', '## 结论\n需修改')).toBe('互审未通过，待你决定');
  });

  it('审查结论标题+文末结论通过 → 审查通过标题', () => {
    expect(
      approvalCardTitle(
        'pending',
        `审查结论:

**问题列表**
- 无阻塞问题。

**建议**
- 可选:...

**验证**
- 亲手运行 \`npm test\` → tests 4 / pass 4 / fail 0

**结论:通过**。改动与任务一致,无需修改。`,
      ),
    ).toBe('审查通过，待你确认');
  });

  it('审查结论标题+文末需修改 → 互审未通过标题', () => {
    expect(
      approvalCardTitle(
        'pending',
        `审查结论:

**问题列表**
- 核心路径漏了空输入。

**建议**
- 可选:...

**验证**
- 亲手运行 \`npm test\` → tests 4 / pass 4 / fail 0

**结论:需修改**。`,
      ),
    ).toBe('互审未通过，待你决定');
  });
});
