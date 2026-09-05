import { describe, expect, it } from 'vitest';
import {
  allowsAutoApprove,
  needsSecondLayerReview,
  gateReviewVerdict,
  hasExplicitReviewVerdict,
  parseReviewVerdict,
} from '../src/review-verdict.js';

/** 真实审查官回复:文首「审查结论:」标题 + 文末「结论:通过」。 */
const LEAD_IN_PASS = `审查结论:

**问题列表**
- 无阻塞问题。

**建议**
- 可选:...

**验证**
- 亲手运行 \`npm test\` → tests 4 / pass 4 / fail 0

**结论:通过**。改动与任务一致,无需修改。`;

/** 同形但文末是需修改;文首标题若抢走匹配,就会一个关键词都不匹配而默认 pass。 */
const LEAD_IN_REVISE = `审查结论:

**问题列表**
- 核心路径漏了空输入。

**建议**
- 可选:...

**验证**
- 亲手运行 \`npm test\` → tests 4 / pass 4 / fail 0

**结论:需修改**。`;

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

  it('审查结论标题+文末结论通过 → pass', () => {
    expect(parseReviewVerdict(LEAD_IN_PASS)).toBe('pass');
  });

  it('安全:审查结论标题抢走匹配时文末需修改不得默认为 pass', () => {
    expect(parseReviewVerdict(LEAD_IN_REVISE)).toBe('revise');
  });

  it('无需修改不当成需修改', () => {
    expect(parseReviewVerdict('结论:改动无需修改,通过')).toBe('pass');
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

  it('审查结论标题+文末结论通过算明确结论', () => {
    expect(hasExplicitReviewVerdict(LEAD_IN_PASS)).toBe(true);
  });

  it('如需修改单独出现不算明确结论', () => {
    expect(hasExplicitReviewVerdict('如需修改命名可另开。')).toBe(false);
  });

  it('加粗结论标题换行后的通过算明确结论', () => {
    expect(hasExplicitReviewVerdict('**结论**\n通过')).toBe(true);
  });
});

describe('gateReviewVerdict', () => {
  it('审查结论标题+文末通过且有验证证据 → pass', () => {
    expect(gateReviewVerdict(LEAD_IN_PASS)).toBe('pass');
  });
});

describe('allowsAutoApprove', () => {
  it('未开开关 → false', () => {
    expect(allowsAutoApprove('结论:通过', false)).toBe(false);
  });

  it('明确通过且有验证证据才自动落地', () => {
    expect(allowsAutoApprove('已运行 `node -e 1` 输出 1\n审查通过', true)).toBe(true);
    expect(allowsAutoApprove('审查通过', true)).toBe(false);
    expect(allowsAutoApprove('## 结论\n需修改', true)).toBe(false);
    expect(allowsAutoApprove('(审查无输出)', true)).toBe(false);
  });
});

describe('needsSecondLayerReview', () => {
  it('只有显式开了远程才要仓外第二层', () => {
    expect(needsSecondLayerReview(true)).toBe(true);
    expect(needsSecondLayerReview(false)).toBe(false);
    expect(needsSecondLayerReview(undefined)).toBe(false);
  });
});
