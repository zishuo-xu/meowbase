import type { MessageStore, ThreadStore } from './ports.js';
import { InMemoryMessageStore, InMemoryThreadStore } from './memory.js';

export function createMemoryStores(): { threads: ThreadStore; messages: MessageStore } {
  return {
    threads: new InMemoryThreadStore(),
    messages: new InMemoryMessageStore(),
  };
}
