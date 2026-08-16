import type { AgentId } from './types.js';

const PREFERRED_PAIRS: Record<AgentId, AgentId> = {
  claude: 'opencode',
  opencode: 'claude',
  gemini: 'claude',
};

export function selectReviewer(
  writer: AgentId,
  available: AgentId[],
): AgentId | undefined {
  const preferred = PREFERRED_PAIRS[writer];
  if (preferred && available.includes(preferred)) return preferred;
  return available.find((id) => id !== writer);
}
