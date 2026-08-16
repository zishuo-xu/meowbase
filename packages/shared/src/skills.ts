import type { Skill } from './types.js';

export function matchSkills(content: string, skills: Skill[]): Skill[] {
  const lower = content.toLowerCase();
  return skills.filter(
    (skill) =>
      skill.always ||
      skill.triggers.some((trigger) => trigger && lower.includes(trigger.toLowerCase())),
  );
}
