export type ReviewVerdict = 'pass' | 'revise';

const REVISE_RE = /需修改|不通过|未通过|请修复|CHANGES_REQUESTED|request changes/i;
const PASS_RE = /通过|LGTM|可以合入|APPROVED/i;

function extractConclusion(text: string): string | null {
  const heading = text.match(/(?:^|\n)#{1,3}\s*结论\s*[:：]?\s*\n?([\s\S]*)$/);
  if (heading?.[1]?.trim()) return heading[1].trim();
  const inline = text.match(/结论\s*[:：]\s*([^\n]+)/);
  if (inline?.[1]?.trim()) return inline[1].trim();
  return null;
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

/** 只有明确「通过」才允许 autoApprove;空意见或需修改都不能自动落地。 */
export function allowsAutoApprove(text: string, autoApprove?: boolean): boolean {
  if (!autoApprove) return false;
  const source = extractConclusion(text) ?? text;
  return parseReviewVerdict(text) === 'pass' && PASS_RE.test(source);
}
