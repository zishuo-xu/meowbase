import type { AgentId } from './types.js';

/** @mention 词元:英文 id 或连续中文名 */
export const MENTION_TOKEN_RE = /@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)/g;

export interface MentionCatalog {
  aliases: Record<string, AgentId>;
  names: Record<AgentId, string>;
}

export interface TeamMember {
  agentId: AgentId;
  name: string;
  role: string;
}

export const DEFAULT_ROSTER: readonly TeamMember[] = [
  { agentId: 'claude', name: '墨墨', role: '主力写手' },
  { agentId: 'gemini', name: '闪闪', role: '审查官' },
  { agentId: 'opencode', name: '团团', role: '执行者' },
];

function aliasKey(token: string): string {
  return /^[a-zA-Z]/.test(token) ? token.toLowerCase() : token;
}

export function buildMentionCatalog(
  members: readonly {
    agentId: AgentId;
    name: string;
    aliases?: readonly string[];
  }[] = [],
): MentionCatalog {
  const aliases: Record<string, AgentId> = {};
  const names = {} as Record<AgentId, string>;
  const add = (row: { agentId: AgentId; name: string; aliases?: readonly string[] }) => {
    names[row.agentId] = row.name;
    aliases[aliasKey(row.agentId)] = row.agentId;
    aliases[aliasKey(row.name)] = row.agentId;
    for (const extra of row.aliases ?? []) {
      const token = extra.replace(/^@/, '');
      if (token) aliases[aliasKey(token)] = row.agentId;
    }
  };
  for (const row of DEFAULT_ROSTER) add(row);
  for (const row of members) add(row);
  return { aliases, names };
}

export const DEFAULT_CATALOG = buildMentionCatalog();

export function resolveAlias(
  token: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId | undefined {
  return catalog.aliases[aliasKey(token)];
}

export function displayName(
  agentId: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): string {
  return catalog.names[agentId] ?? agentId;
}
