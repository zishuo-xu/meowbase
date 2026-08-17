/** 本轮亲手跑过的命令(不是「应该有测试」这种空话) */
const COMMAND_RE =
  /已(?:实际)?运行|(?:^|[\n`])\s*(?:\$\s*)?(?:pnpm|npm|npx|node|tsx|vitest|python3?|curl)\b|`(?:pnpm|npm|npx|node|tsx|vitest)[^`]*`/m;

/** 命令对应的结果 */
const RESULT_RE = /返回|输出|exit(?:\s*code)?|✓|✔|\bpass\b|\bfail\b|报错|行为正确|得到\s*\S+/i;

/** 写明跑不了,算诚实交代,不够当「通过」的证据 */
const LIMIT_RE = /跑不了[:：]|无法运行[:：]|验证受限[:：]/;

export function hasVerificationEvidence(text: string): boolean {
  return COMMAND_RE.test(text) && RESULT_RE.test(text);
}

export function hasVerificationLimit(text: string): boolean {
  return LIMIT_RE.test(text);
}
