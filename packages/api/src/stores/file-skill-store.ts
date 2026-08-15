import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Skill } from '@meowbase/shared';
import type { SkillStore } from './ports.js';

interface ManifestSkill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  promptFile: string;
}

export class FileSkillStore implements SkillStore {
  private readonly skills = new Map<string, Skill>();

  constructor(private readonly rootDir: string) {
    this.load();
  }

  private load(): void {
    const manifest = JSON.parse(
      readFileSync(join(this.rootDir, 'manifest.json'), 'utf8'),
    ) as { skills: ManifestSkill[] };
    for (const item of manifest.skills) {
      const prompt = readFileSync(
        join(this.rootDir, 'prompts', item.promptFile),
        'utf8',
      ).trim();
      this.skills.set(item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        triggers: item.triggers,
        prompt,
      });
    }
  }

  async list(): Promise<Skill[]> {
    return [...this.skills.values()];
  }

  async get(id: string): Promise<Skill | null> {
    return this.skills.get(id) ?? null;
  }
}
