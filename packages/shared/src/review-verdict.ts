import { hasVerificationEvidence } from './verification.js';

export type ReviewVerdict = 'pass' | 'revise';
export type GatedVerdict = ReviewVerdict | 'incomplete';

const REVISE_RE = /需修改|不通过|未通过|请修复|CHANGES_REQUESTED|request changes/i;
const PASS_RE = /通过|LGTM|可以合入|APPROVED/i;

function extractConclusion(text: string): string | null {
  const heading = text.match(/(?:^|\n)#{1,3}\s*结论\s*[:：]?\s*\n?([\s\S]*)$/);
  if (heading?.[1]?.trim()) return heading[1].trim();
  const inline = text.match(/结论\s*[:：]\s*([^\n]+)/);
  if (inline?.[1]?.trim()) return inline[1].trim();
  return null;
}

/** 正文或结论段里是否明确写了通过/需修改。没有关键词时 parseReviewVerdict 会默认 pass,不能用来判断「已经收棒」。 */
export function hasExplicitReviewVerdict(text: string): boolean {
  const source = extractConclusion(text) ?? text;
  return REVISE_RE.test(source) || PASS_RE.test(source);
}

/** 从审查官输出里读结论:需修改则打回写手,通过才交给人。结论段里两个词都有时,取先出现的。 */
export function parseReviewVerdict(text: string): ReviewVerdict {
  const source = extractConclusion(text) ?? text;
  const reviseIdx = source.search(REVISE_RE);
  const passIdx = source.search(PASS_RE);
  if (reviseIdx >= 0 && (passIdx < 0 || reviseIdx <= passIdx)) return 'revise';
  if (passIdx >= 0) return 'pass';
  return 'pass';
}

/** 通过必须带本轮验证证据(自己或上一棒的命令+结果);没证据不能当通过。不拦 @。 */
export function gateReviewVerdict(
  reviewText: string,
  evidenceTexts: readonly string[] = [],
): GatedVerdict {
  if (parseReviewVerdict(reviewText) === 'revise') return 'revise';
  const source = extractConclusion(reviewText) ?? reviewText;
  if (!PASS_RE.test(source)) return 'incomplete';
  const pool = [reviewText, ...evidenceTexts];
  return pool.some((text) => hasVerificationEvidence(text)) ? 'pass' : 'incomplete';
}

/** 只有明确通过且有验证证据才允许 autoApprove。 */
export function allowsAutoApprove(
  text: string,
  autoApprove?: boolean,
  evidenceTexts: readonly string[] = [],
): boolean {
  if (!autoApprove) return false;
  return gateReviewVerdict(text, evidenceTexts) === 'pass';
}
