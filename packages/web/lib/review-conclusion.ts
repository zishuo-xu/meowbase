/** 有意镜像 shared/src/review-verdict.ts,web 不依赖 @meowbase/shared。 */

export const REVISE_RE =
  /(?<![无不如])需修改|不通过|未通过|请修复|CHANGES_REQUESTED|request changes/i;
export const PASS_RE = /通过|LGTM|可以合入|APPROVED/i;

const HEADING_LINE_RE =
  /^[ \t]*(?:#{1,3}[ \t]*)?(?:\*\*)?[\u4e00-\u9fffA-Za-z]*结论(?:\*\*)?[ \t]*[:：]?[ \t]*(?:\*\*)?[ \t]*$/;
const INLINE_RE = /结论(?:\*\*)?[ \t]*[:：][ \t]*([^\n]+)/;

function hasVerdictKeyword(text: string): boolean {
  return text.search(REVISE_RE) >= 0 || text.search(PASS_RE) >= 0;
}

export function extractConclusion(text: string): string | null {
  const candidates: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/\r$/, '');
    if (HEADING_LINE_RE.test(line)) {
      candidates.push(lines.slice(i + 1).join('\n'));
    }
    const inline = line.match(INLINE_RE);
    if (inline?.[1]?.trim()) candidates.push(inline[1]);
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (candidate && hasVerdictKeyword(candidate)) return candidate.trim();
  }
  return null;
}
