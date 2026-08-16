import type { AgentId } from './types.js';

/** 默认审查官是闪闪;闪闪自己写则交墨墨。对方不在时退回第一个其他人。 */
const PREFERRED_PAIRS: Record<AgentId, AgentId> = {
  claude: 'gemini',
  opencode: 'gemini',
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
