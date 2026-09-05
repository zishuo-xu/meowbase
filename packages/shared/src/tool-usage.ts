import type { AgentId, Message, ToolActivity } from './types.js';

export type ToolCategory = 'builtin' | 'skill' | 'mcp';

export interface SkillUsageRow {
  id: string;
  count: number;
}

export interface ToolUsageRow {
  name: string;
  category: ToolCategory;
  count: number;
}

export interface ToolUsageSummary {
  skills: SkillUsageRow[];
  tools: ToolUsageRow[];
  total: { skillInjections: number; toolCalls: number };
}

/** mcp__ / mcp: 归 mcp; Skill / skill: / skill__ 归 skill; 思考不算。 */
export function classifyTool(name: string): ToolCategory | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '思考') return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('mcp__') || lower.startsWith('mcp:')) return 'mcp';
  if (lower === 'skill' || lower.startsWith('skill:') || lower.startsWith('skill__')) return 'skill';
  return 'builtin';
}

type Countable = Pick<Message, 'role' | 'status' | 'agentId' | 'skillIds' | 'activities'>;

function isCountable(message: Countable): message is Countable & { agentId: AgentId } {
  return message.role === 'assistant' && message.status === 'completed' && message.agentId != null;
}

function sortRows<T extends { count: number }>(rows: T[], keyOf: (row: T) => string): T[] {
  return [...rows].sort((a, b) => b.count - a.count || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

/** 只算跑完的助手消息。技能按 id,工具按显示名;思考跳过。 */
export function sumToolUsage(messages: ReadonlyArray<Countable>): ToolUsageSummary {
  const skillCounts = new Map<string, number>();
  const toolCounts = new Map<string, { category: ToolCategory; count: number }>();

  for (const message of messages) {
    if (!isCountable(message)) continue;
    for (const id of message.skillIds ?? []) {
      if (!id) continue;
      skillCounts.set(id, (skillCounts.get(id) ?? 0) + 1);
    }
    for (const activity of message.activities ?? []) {
      addTool(toolCounts, activity);
    }
  }

  const skills = sortRows(
    [...skillCounts.entries()].map(([id, count]) => ({ id, count })),
    (row) => row.id,
  );
  const tools = sortRows(
    [...toolCounts.entries()].map(([name, row]) => ({ name, ...row })),
    (row) => row.name,
  );
  return {
    skills,
    tools,
    total: {
      skillInjections: skills.reduce((sum, row) => sum + row.count, 0),
      toolCalls: tools.reduce((sum, row) => sum + row.count, 0),
    },
  };
}

function addTool(
  toolCounts: Map<string, { category: ToolCategory; count: number }>,
  activity: Pick<ToolActivity, 'name'>,
): void {
  const category = classifyTool(activity.name);
  if (!category) return;
  const current = toolCounts.get(activity.name);
  if (current) current.count += 1;
  else toolCounts.set(activity.name, { category, count: 1 });
}
