import { Redis } from 'ioredis';
import type { EvidenceStore, MessageStore, ProfileStore, ThreadStore } from './ports.js';
import {
  InMemoryEvidenceStore,
  InMemoryMessageStore,
  InMemoryProfileStore,
  InMemoryThreadStore,
} from './memory.js';
import {
  RedisEvidenceStore,
  RedisMessageStore,
  RedisProfileStore,
  RedisThreadStore,
} from './redis.js';

export function createMemoryStores(): {
  threads: ThreadStore;
  messages: MessageStore;
  profiles: ProfileStore;
  evidence: EvidenceStore;
} {
  return {
    threads: new InMemoryThreadStore(),
    messages: new InMemoryMessageStore(),
    profiles: new InMemoryProfileStore(),
    evidence: new InMemoryEvidenceStore(),
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
