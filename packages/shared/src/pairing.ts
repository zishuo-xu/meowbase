import type { AgentId } from './types.js';
import { DEFAULT_ROSTER, type TeamMember } from './catalog.js';

export function selectReviewer(
  writer: AgentId,
  available: AgentId[],
  team: readonly Pick<TeamMember, 'agentId' | 'handoffTo'>[] = DEFAULT_ROSTER,
): AgentId | undefined {
  const preferred = team.find((m) => m.agentId === writer)?.handoffTo;
  if (preferred && preferred !== writer && available.includes(preferred)) return preferred;
  return available.find((id) => id !== writer);
}
