import { describe, expect, it } from 'vitest';
import { hasVerificationEvidence, hasVerificationLimit } from '../src/verification.js';
import { allowsAutoApprove, gateReviewVerdict } from '../src/review-verdict.js';

describe('hasVerificationEvidence', () => {
  it('本轮命令加结果才算', () => {
    expect(hasVerificationEvidence('已实际运行 `add(2,3)`,返回 5,行为正确。')).toBe(true);
    expect(hasVerificationEvidence('跑了 `tsx add.ts`,输出 5')).toBe(true);
    expect(hasVerificationEvidence('已写 add.ts,建议补测试')).toBe(false);
    expect(hasVerificationEvidence('应该有测试')).toBe(false);
  });

  it('跑不了只算限制,不算验证证据', () => {
    expect(hasVerificationLimit('跑不了:沙箱没有 tsx')).toBe(true);
    expect(hasVerificationEvidence('跑不了:沙箱没有 tsx')).toBe(false);
  });
});

describe('gateReviewVerdict', () => {
  it('需修改仍是需修改', () => {
    expect(gateReviewVerdict('## 结论\n需修改\n- 补测试')).toBe('revise');
  });

  it('写了通过但没有本轮命令和结果 → 不算通过', () => {
    expect(gateReviewVerdict('## 结论\n通过')).toBe('incomplete');
    expect(gateReviewVerdict('审查通过')).toBe('incomplete');
  });

  it('审查官或上一棒带了命令和结果,通过才算通过', () => {
    expect(
      gateReviewVerdict('## 结论\n通过', ['已实际运行 `add(2,3)`,返回 5,行为正确。']),
    ).toBe('pass');
    expect(
      gateReviewVerdict('已运行 `node -e "console.log(1)"` 输出 1\n## 结论\n通过'),
    ).toBe('pass');
  });

  it('只写跑不了不能当通过', () => {
    expect(gateReviewVerdict('跑不了:没有运行时\n## 结论\n通过')).toBe('incomplete');
  });
});

describe('allowsAutoApprove', () => {
  it('通过但没有验证证据不能自动落地', () => {
    expect(allowsAutoApprove('审查通过', true)).toBe(false);
    expect(allowsAutoApprove('已实际运行 add(2,3),返回 5\n结论:通过', true)).toBe(true);
  });
});
