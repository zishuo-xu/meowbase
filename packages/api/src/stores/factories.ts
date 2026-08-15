import type Redis from 'ioredis';
import type { MessageStore, ThreadStore } from './ports.js';
import { InMemoryMessageStore, InMemoryThreadStore } from './memory.js';
import { RedisMessageStore, RedisThreadStore } from './redis.js';

export function createMemoryStores(): { threads: ThreadStore; messages: MessageStore } {
  return {
    threads: new InMemoryThreadStore(),
    messages: new InMemoryMessageStore(),
  };
}

export function createThreadStore(redis: Redis): ThreadStore {
  return new RedisThreadStore(redis);
}

export function createMessageStore(redis: Redis): MessageStore {
  return new RedisMessageStore(redis);
}
