/**
 * 并行组切分:消息按 `|` 分隔为多个独立任务组,组间并行执行;
 * 组内仍按 @mention 串行接力。无 `|` 时整条消息为一个组。
 */
export function parseParallelGroups(content: string): string[] {
  return content
    .split('|')
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}
