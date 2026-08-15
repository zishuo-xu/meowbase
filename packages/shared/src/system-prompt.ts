import type { AgentProfile, EvidenceEntry } from './types.js';

export function buildSystemPrompt(input: {
  profile?: AgentProfile;
  evidenceRefs: EvidenceEntry[];
}): string | undefined {
  const parts: string[] = [];
  if (input.profile) {
    const p = input.profile;
    parts.push(
      `你是 ${p.name},${p.role}。性格:${p.personality}。擅长:${p.expertise.join('、')}。`,
    );
  }
  if (input.evidenceRefs.length > 0) {
    const lines = input.evidenceRefs.map(
      (e) => `- [${e.kind}] ${e.title}: ${e.content}`,
    );
    parts.push(`团队记忆:\n${lines.join('\n')}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
