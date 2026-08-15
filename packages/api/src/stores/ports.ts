import type { AgentId, Message, Thread } from '@meowbase/shared';

export interface ThreadStore {
  create(input: {
    title: string;
    primaryAgentId: AgentId;
    /** 线程工作目录的基准路径;不传时默认相对路径 'work'(与历史行为一致) */
    workdirBase?: string;
  }): Promise<Thread>;
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
