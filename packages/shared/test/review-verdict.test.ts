import { describe, expect, it } from 'vitest';
import { allowsAutoApprove, hasExplicitReviewVerdict, parseReviewVerdict } from '../src/review-verdict.js';

describe('parseReviewVerdict', () => {
  it('结论需修改 → revise', () => {
    expect(
      parseReviewVerdict('## 建议\n改泛型\n\n## 结论\n**需修改** — 核心算法正确,但 #1 要处理'),
    ).toBe('revise');
  });

  it('结论通过 → pass', () => {
    expect(parseReviewVerdict('问题:无\n## 结论\n通过')).toBe('pass');
    expect(parseReviewVerdict('审查意见:通过')).toBe('pass');
    expect(parseReviewVerdict('审查通过')).toBe('pass');
  });

  it('结论段同时出现时取先出现的词', () => {
    expect(parseReviewVerdict('结论：通过，个别命名如需修改可后续处理')).toBe('pass');
    expect(parseReviewVerdict('结论：需修改 — 8 个用例全过,但栈溢出要修')).toBe('revise');
  });

  it('正文里的「如需修改」不盖过结论通过', () => {
    expect(parseReviewVerdict('如需修改命名可另开。\n结论:通过')).toBe('pass');
  });
});

describe('hasExplicitReviewVerdict', () => {
  it('写了通过或需修改才算明确结论', () => {
    expect(hasExplicitReviewVerdict('## 结论\n通过')).toBe(true);
    expect(hasExplicitReviewVerdict('审查通过')).toBe(true);
    expect(hasExplicitReviewVerdict('## 结论\n需修改\n- 补测试')).toBe(true);
    expect(hasExplicitReviewVerdict('看了一下还行')).toBe(false);
    expect(hasExplicitReviewVerdict('(审查无输出)')).toBe(false);
  });
});

describe('allowsAutoApprove', () => {
  it('未开开关 → false', () => {
    expect(allowsAutoApprove('结论:通过', false)).toBe(false);
  });

  it('明确通过才自动落地', () => {
    expect(allowsAutoApprove('审查通过', true)).toBe(true);
    expect(allowsAutoApprove('## 结论\n需修改', true)).toBe(false);
    expect(allowsAutoApprove('(审查无输出)', true)).toBe(false);
  });
});
