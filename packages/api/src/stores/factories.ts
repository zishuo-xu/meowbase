import { Redis } from 'ioredis';
import type { Skill } from '@meowbase/shared';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from './ports.js';
import {
  InMemoryApprovalStore,
  InMemoryEvidenceStore,
  InMemoryMessageStore,
  InMemoryProfileStore,
  InMemorySkillStore,
  InMemoryThreadStore,
} from './memory.js';
import {
  RedisApprovalStore,
  RedisEvidenceStore,
  RedisMessageStore,
  RedisProfileStore,
  RedisThreadStore,
} from './redis.js';
import { FileSkillStore } from './file-skill-store.js';

export function createMemoryStores(skills: Skill[] = []): {
  threads: ThreadStore;
  messages: MessageStore;
  profiles: ProfileStore;
  evidence: EvidenceStore;
  skills: SkillStore;
  approvals: ApprovalStore;
} {
  return {
    threads: new InMemoryThreadStore(),
    messages: new InMemoryMessageStore(),
    profiles: new InMemoryProfileStore(),
    evidence: new InMemoryEvidenceStore(),
    skills: new InMemorySkillStore(skills),
    approvals: new InMemoryApprovalStore(),
  };
}

export function createThreadStore(redis: Redis): ThreadStore {
  return new RedisThreadStore(redis);
}

export function createMessageStore(redis: Redis): MessageStore {
  return new RedisMessageStore(redis);
}

export function createProfileStore(redis: Redis): ProfileStore {
  return new RedisProfileStore(redis);
}

export function createEvidenceStore(redis: Redis): EvidenceStore {
  return new RedisEvidenceStore(redis);
}

export function createSkillStore(skillsDir: string): SkillStore {
  return new FileSkillStore(skillsDir);
}

export function createApprovalStore(redis: Redis): ApprovalStore {
  return new RedisApprovalStore(redis);
}
