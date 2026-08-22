import {
  buildMentionCatalog,
  DEFAULT_ROSTER,
  isHumanEscalateToken,
} from '@meowbase/shared';
import type { AgentProfile, MentionCatalog, TeamMember, ThreadRepo } from '@meowbase/shared';
import type { AgentSpec } from '../../config.js';
import { gitChangedPaths, resolveDiffMarker } from '../../services/git.js';
import { MAX_A2A_DEPTH, type TurnContext } from './types.js';

export function overlayProfile(
  stored: AgentProfile | undefined,
  spec: AgentSpec | undefined,
): AgentProfile | undefined {
  if (!spec) return stored;
  return {
    agentId: spec.id,
    name: spec.name,
    personality: spec.personality,
    role: spec.role,
    expertise: spec.expertise,
    autoApprove: stored?.autoApprove,
    createdAt: stored?.createdAt ?? new Date().toISOString(),
  };
}

export async function loadRoster(context: TurnContext): Promise<{
  catalog: MentionCatalog;
  team: TeamMember[];
  maxDepth: number;
}> {
  const profiles = await context.stores.profiles.list();
  const members =
    context.agents?.map((a) => ({
      agentId: a.id,
      name: a.name,
      aliases: a.aliases,
    })) ?? profiles.map((p) => ({ agentId: p.agentId, name: p.name }));
  const catalog = buildMentionCatalog(members);
  const team: TeamMember[] =
    context.agents && context.agents.length > 0
      ? context.agents.map((a) => ({
          agentId: a.id,
          name: a.name,
          role: a.role,
          handoffTo: a.handoffTo,
          handoff: a.handoff,
          doneWhen: a.doneWhen,
        }))
      : profiles.length > 0
        ? profiles.map((p) => ({ agentId: p.agentId, name: p.name, role: p.role }))
        : [...DEFAULT_ROSTER];
  return { catalog, team, maxDepth: context.a2aMaxDepth ?? MAX_A2A_DEPTH };
}

export function isReviewerRole(role?: string): boolean {
  return Boolean(role && role.includes('审查'));
}

export async function listHandoffFiles(workdir: string, repo?: ThreadRepo): Promise<string[]> {
  try {
    const from = await resolveDiffMarker(workdir, repo);
    return await gitChangedPaths(workdir, from);
  } catch {
    return [];
  }
}

export function userEscalates(content: string): boolean {
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*@(\S+)/);
    if (match && isHumanEscalateToken(match[1] ?? '')) return true;
  }
  return false;
}
