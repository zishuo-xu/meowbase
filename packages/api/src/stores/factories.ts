import { Redis } from 'ioredis';
import type { Skill } from '@meowbase/shared';
import type {
  AppStores,
  ApprovalStore,
  AuditStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from './ports.js';
import {
  InMemoryApprovalStore,
  InMemoryAuditStore,
  InMemoryEvidenceStore,
  InMemoryMessageStore,
  InMemoryProfileStore,
  InMemorySkillStore,
  InMemoryThreadStore,
} from './memory.js';
import {
  RedisApprovalStore,
  RedisAuditStore,
  RedisEvidenceStore,
  RedisMessageStore,
  RedisProfileStore,
  RedisThreadStore,
} from './redis.js';
import { FileSkillStore } from './file-skill-store.js';

export function createMemoryStores(skills: Skill[] = []): AppStores {
  return {
    threads: new InMemoryThreadStore(),
    messages: new InMemoryMessageStore(),
    profiles: new InMemoryProfileStore(),
    evidence: new InMemoryEvidenceStore(),
    skills: new InMemorySkillStore(skills),
    approvals: new InMemoryApprovalStore(),
    audit: new InMemoryAuditStore(),
  };
}

export function createRedisStores(redis: Redis, skillsDir: string): AppStores {
  return {
    threads: new RedisThreadStore(redis),
    messages: new RedisMessageStore(redis),
    profiles: new RedisProfileStore(redis),
    evidence: new RedisEvidenceStore(redis),
    skills: new FileSkillStore(skillsDir),
    approvals: new RedisApprovalStore(redis),
    audit: new RedisAuditStore(redis),
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

export function createAuditStore(redis: Redis): AuditStore {
  return new RedisAuditStore(redis);
}
