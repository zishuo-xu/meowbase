import type { AgentId, Message, Thread } from '@meowbase/shared';

export interface ThreadStore {
  create(input: { title: string; primaryAgentId: AgentId }): Promise<Thread>;
  get(id: string): Promise<Thread | null>;
  list(): Promise<Thread[]>;
  setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void>;
}

export interface MessageStore {
  append(input: {
    threadId: string;
    role: Message['role'];
    agentId?: AgentId;
    content: string;
    status: Message['status'];
    sessionId?: string;
    usage?: Message['usage'];
    error?: string;
  }): Promise<Message>;
  get(threadId: string, messageId: string): Promise<Message | null>;
  list(threadId: string): Promise<Message[]>;
  patch(
    threadId: string,
    messageId: string,
    patch: Partial<Omit<Message, 'id' | 'threadId' | 'createdAt'>>,
  ): Promise<Message>;
}
