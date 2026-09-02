import type { AgentId } from './types.js';
import { DEFAULT_ROSTER, type TeamMember } from './catalog.js';

/** diff 风险面:安全 > 契约 > 默认。路径表驱动,命中多档取高。 */
export type DiffRisk = 'safety' | 'contract' | 'default';

const SAFETY_PATHS = [
  'packages/shared/src/hold-command.ts',
  'packages/shared/src/repo-path.ts',
] as const;

const CONTRACT_PATHS = ['AGENTS.md'] as const;
const CONTRACT_PREFIXES = ['packages/shared/src/'] as const;

export function classifyDiffRisk(files: readonly string[]): DiffRisk {
  if (files.some((f) => SAFETY_PATHS.some((p) => f === p || f.endsWith(`/${p}`)))) return 'safety';
  if (
    files.some(
      (f) =>
        CONTRACT_PATHS.some((p) => f === p || f.endsWith(`/${p}`)) ||
        CONTRACT_PREFIXES.some((p) => f.startsWith(p)),
    )
  )
    return 'contract';
  return 'default';
}

export function selectReviewer(
  writer: AgentId,
  available: AgentId[],
  team: readonly Pick<TeamMember, 'agentId' | 'handoffTo' | 'reviewRisk'>[] = DEFAULT_ROSTER,
  risk: DiffRisk = 'default',
): AgentId | undefined {
  if (risk !== 'default') {
    const riskReviewer = team.find(
      (m) => m.agentId !== writer && m.reviewRisk?.includes(risk) && available.includes(m.agentId),
    );
    if (riskReviewer) return riskReviewer.agentId;
  }
  const preferred = team.find((m) => m.agentId === writer)?.handoffTo;
  if (preferred && preferred !== writer && available.includes(preferred)) return preferred;
  return available.find((id) => id !== writer);
}
