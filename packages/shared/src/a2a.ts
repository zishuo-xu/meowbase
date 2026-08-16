import type { AgentId } from './types.js';

export interface A2AHandoff {
  target: AgentId;
  task: string;
}

const MENTION_LINE = /^\s*@(claude|gemini|opencode)\b\s*(.*)$/;
const MENTION_LINE_ANY = /^\s*@(claude|gemini|opencode)\b/;

/**
 * A2A 接力检测(借鉴 clowder F046):解析 agent 回复文本中
 * 行首的 @mention → 平台把任务自动交接给目标 agent。
 * 仅行首 mention 触发;过滤自调用;任务为空不触发。
 */
export function parseA2AHandoff(
  text: string,
  currentAgentId?: AgentId,
): A2AHandoff | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(MENTION_LINE);
    if (!match) continue;
    const target = match[1] as AgentId | undefined;
    if (!target || target === currentAgentId) continue;
    const rest = lines
      .slice(i + 1)
      .filter((l) => !MENTION_LINE_ANY.test(l))
      .join('\n')
      .trim();
    const task = [match[2]?.trim(), rest].filter(Boolean).join('\n').trim();
    if (task) return { target, task };
  }
  return null;
}
