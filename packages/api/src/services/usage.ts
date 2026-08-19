import type { AgentId, Message, TokenUsage } from '@meowbase/shared';
import { mergeTokenUsage } from '@meowbase/shared';
import type { AppStores } from '../stores/ports.js';

export interface UsageSummary {
  byAgent: Partial<Record<AgentId, TokenUsage>>;
  total: TokenUsage;
}

type UsageMessage = Pick<Message, 'role' | 'status' | 'agentId' | 'usage'>;

/** 半截的和失败的不算钱;没报用量的完成态也没什么可加。 */
function isBillable(
  message: UsageMessage,
): message is UsageMessage & { agentId: AgentId; usage: TokenUsage } {
  return (
    message.role === 'assistant' &&
    message.status === 'completed' &&
    message.agentId != null &&
    message.usage != null
  );
}

export function sumUsage(messages: ReadonlyArray<UsageMessage>): UsageSummary {
  const byAgent: Partial<Record<AgentId, TokenUsage>> = {};
  let total: TokenUsage | undefined;

  for (const message of messages) {
    if (!isBillable(message)) continue;
    byAgent[message.agentId] = mergeTokenUsage(byAgent[message.agentId], message.usage);
    total = mergeTokenUsage(total, message.usage);
  }

  return { byAgent, total: total ?? {} };
}

export async function loadUsage(
  stores: Pick<AppStores, 'threads' | 'messages'>,
  threadId?: string,
): Promise<UsageSummary> {
  if (threadId) {
    return sumUsage(await stores.messages.list(threadId));
  }
  const threads = await stores.threads.list();
  const bundled: Message[] = [];
  for (const thread of threads) {
    bundled.push(...(await stores.messages.list(thread.id)));
  }
  return sumUsage(bundled);
}
