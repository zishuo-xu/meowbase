import type { AgentProfile, EvidenceEntry, Skill } from './types.js';

export function buildSystemPrompt(input: {
  profile?: AgentProfile;
  skills?: Skill[];
  evidenceRefs: EvidenceEntry[];
}): string | undefined {
  const parts: string[] = [];
  if (input.profile) {
    const p = input.profile;
    parts.push(
      `你是 ${p.name},${p.role}。性格:${p.personality}。擅长:${p.expertise.join('、')}。` +
        `\n团队协作:需要其他成员协助时,在回复末尾另起一行用 @claude/@gemini/@opencode 交接任务。` +
        `\n工作区规则:所有文件创建/修改都发生在当前工作目录(线程沙箱)内,只使用相对路径,禁止读写工作目录以外的路径。`,
    );
  }
  if (input.skills && input.skills.length > 0) {
    const lines = input.skills.map((s) => `[技能:${s.name}] ${s.prompt}`);
    parts.push(`本轮请遵循以下技能:\n${lines.join('\n\n')}`);
  }
  if (input.evidenceRefs.length > 0) {
    const lines = input.evidenceRefs.map(
      (e) => `- [${e.kind}] ${e.title}: ${e.content}`,
    );
    parts.push(`团队记忆:\n${lines.join('\n')}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
