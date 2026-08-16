import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  MENTION_TOKEN_RE,
  type MentionCatalog,
  resolveAlias,
} from './catalog.js';

export interface A2AHandoff {
  target: AgentId;
  task: string;
}

const LINE_START = /^\s*@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)\s*(.*)$/;
const LINE_START_ANY = /^\s*@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)/;

/**
 * A2A 接力检测(借鉴 clowder F046):解析 agent 回复文本中
 * 行首的 @mention → 平台把任务自动交接给目标 agent。
 * 仅行首 mention 触发;过滤自调用;任务为空不触发。
 * 中文名与英文 id 等价(@墨墨 = @claude)。
 */
export function parseA2AHandoff(
  text: string,
  currentAgentId?: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): A2AHandoff | null {
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(LINE_START);
    if (!match) continue;
    const target = resolveAlias(match[1] ?? '', catalog);
    if (!target || target === currentAgentId) continue;
    const rest = lines
      .slice(i + 1)
      .filter((l) => !LINE_START_ANY.test(l))
      .join('\n')
      .trim();
    const task = [match[2]?.trim(), rest].filter(Boolean).join('\n').trim();
    if (task) return { target, task };
  }
  return null;
}

/** 句中(非行首)的有效 @mention — 用于提示「这样写不会交接」 */
export function findInlineA2AMentions(
  text: string,
  currentAgentId?: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId[] {
  const found: AgentId[] = [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const lines = stripped.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const start = line.match(LINE_START);
    const startId = start ? resolveAlias(start[1] ?? '', catalog) : undefined;
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    for (const match of line.matchAll(re)) {
      const id = resolveAlias(match[1] ?? '', catalog);
      if (!id || id === currentAgentId) continue;
      const atLineStart = startId === id && match.index === line.search(/@/);
      if (atLineStart) continue;
      if (!found.includes(id)) found.push(id);
    }
  }
  return found;
}

/** 把上一棒的输出包装成下一棒能读懂的任务信封 */
export function formatA2AHandoffPrompt(
  fromName: string,
  fromId: AgentId,
  previousOutput: string,
  task: string,
): string {
  return (
    `【A2A 交接】上一棒 ${fromName} (@${fromId}) 的输出:\n${previousOutput}\n\n` +
    `---\n【你的任务】\n${task}`
  );
}
