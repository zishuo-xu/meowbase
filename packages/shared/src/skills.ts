import type { Skill } from './types.js';

export function matchSkills(content: string, skills: Skill[]): Skill[] {
  const lower = content.toLowerCase();
  return skills.filter((skill) =>
    skill.triggers.some((trigger) => lower.includes(trigger.toLowerCase())),
  );
}
