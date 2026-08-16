import type { AgentProfile } from '@meowbase/shared';
import { DEFAULT_AGENTS, profilesFromAgents } from '../config.js';
import type { ProfileStore } from './ports.js';

export const SEED_PROFILES: Omit<AgentProfile, 'createdAt'>[] = profilesFromAgents(DEFAULT_AGENTS);

export async function ensureSeededProfiles(store: ProfileStore): Promise<void> {
  for (const seed of SEED_PROFILES) {
    const existing = await store.get(seed.agentId);
    if (!existing) await store.create(seed);
  }
}
