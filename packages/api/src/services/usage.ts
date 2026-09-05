import type {
  AgentId,
  EvidenceRecallSummary,
  Message,
  TokenUsage,
  ToolUsageSummary,
} from '@meowbase/shared';
import { mergeTokenUsage, sumEvidenceRecall, sumToolUsage, totalTokensOf } from '@meowbase/shared';
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

  const merged = total ?? {};
  const derivedTotalTokens = Object.values(byAgent).reduce(
    (sum, usage) => sum + totalTokensOf(usage),
    0,
  );
  return {
    byAgent,
    total:
      Object.keys(byAgent).length === 0
        ? merged
        : { ...merged, totalTokens: derivedTotalTokens },
  };
}

export async function loadUsage(
  stores: Pick<AppStores, 'threads' | 'messages'>,
  threadId?: string,
): Promise<UsageSummary> {
  return sumUsage(await listUsageMessages(stores, threadId));
}

export async function loadToolUsage(
  stores: Pick<AppStores, 'threads' | 'messages'>,
  threadId?: string,
): Promise<ToolUsageSummary> {
  return sumToolUsage(await listUsageMessages(stores, threadId));
}

export async function loadEvidenceRecall(
  stores: Pick<AppStores, 'threads' | 'messages'>,
  threadId?: string,
): Promise<EvidenceRecallSummary> {
  return sumEvidenceRecall(await listUsageMessages(stores, threadId));
}

async function listUsageMessages(
  stores: Pick<AppStores, 'threads' | 'messages'>,
  threadId?: string,
): Promise<Message[]> {
  if (threadId) return stores.messages.list(threadId);
  const threads = await stores.threads.list();
  const bundled: Message[] = [];
  for (const thread of threads) {
    bundled.push(...(await stores.messages.list(thread.id)));
  }
  return bundled;
}
