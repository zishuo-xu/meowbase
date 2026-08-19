import { randomUUID } from 'node:crypto';
import {
  formatHoldCommandRestartNote,
  formatHoldCommandRestartWakePrompt,
} from '@meowbase/shared';
import { clip, formatTurnLog } from '../services/turn-log.js';
import type { MessageStore, ThreadStore } from '../stores/ports.js';
import { followPendingChain } from './execute-turn.js';
import type { TurnContext } from './turn/types.js';

export const HOP_LEASE_TTL_MS = 60_000;
export const HOP_LEASE_RENEW_MS = 20_000;
export const HOP_SWEEP_INTERVAL_MS = 30_000;
/** 搁太久的棒开机不自己捡:人早走了,别背着人烧钱。0 关掉。 */
export const HOP_STALE_AFTER_MS = 30 * 60_000;

export interface PendingRunnerPrepared {
  context: TurnContext;
  release?: () => void;
}

export interface PendingRunnerDeps {
  threads: ThreadStore;
  messages: MessageStore;
  /** 每次跑一棒时现拼 TurnContext(HTTP 那份带 WS 回调和 AbortSignal)。 */
  createContext: (threadId: string) => PendingRunnerPrepared;
  log?: (line: string) => void;
  leaseTtlMs?: number;
  leaseRenewMs?: number;
  sweepIntervalMs?: number;
  staleAfterMs?: number;
}

export interface PendingRunner {
  run(threadId: string, prepared?: PendingRunnerPrepared): Promise<void>;
  sweep(): Promise<void>;
  start(): void;
  stop(): void;
}

async function abandonHoldCommand(threadId: string, context: TurnContext): Promise<void> {
  const pending = (await context.stores.threads.get(threadId))?.pendingHop;
  if (!pending?.holdCommand) return;
  await context.stores.messages.append({
    threadId,
    role: 'system',
    content: formatHoldCommandRestartNote(pending.holdCommand),
    status: 'completed',
  });
  await context.stores.threads.setPendingHop(threadId, {
    ...pending,
    from: pending.to,
    task: formatHoldCommandRestartWakePrompt({
      command: pending.holdCommand,
      previousOutput: pending.previousOutput,
    }),
    holdCommand: undefined,
  });
}

export function createPendingRunner(deps: PendingRunnerDeps): PendingRunner {
  const leaseTtlMs = deps.leaseTtlMs ?? HOP_LEASE_TTL_MS;
  const leaseRenewMs = deps.leaseRenewMs ?? HOP_LEASE_RENEW_MS;
  const sweepIntervalMs = deps.sweepIntervalMs ?? HOP_SWEEP_INTERVAL_MS;
  const staleAfterMs = deps.staleAfterMs ?? HOP_STALE_AFTER_MS;
  const write = deps.log ?? ((line: string) => console.log(line));
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweeping = false;

  async function run(threadId: string, prepared?: PendingRunnerPrepared): Promise<void> {
    const runnerId = randomUUID();
    const claimed = await deps.threads.claimPendingHop(threadId, runnerId, leaseTtlMs);
    if (!claimed) {
      prepared?.release?.();
      return;
    }
    write(formatTurnLog('resume claim', { thread: threadId, runner: runnerId.slice(0, 8) }));
    let release: (() => void) | undefined;
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const created = prepared ?? deps.createContext(threadId);
      release = created.release;
      if (!prepared) {
        await abandonHoldCommand(threadId, created.context);
      }
      renewTimer = setInterval(() => {
        void deps.threads.renewPendingHopLease(threadId, runnerId, leaseTtlMs).then((ok) => {
          if (!ok) write(formatTurnLog('resume lease lost', { thread: threadId }));
        });
      }, leaseRenewMs);
      renewTimer.unref();
      await followPendingChain({ threadId, context: created.context });
    } catch (err) {
      write(formatTurnLog('resume fail', { thread: threadId, error: clip(String(err), 120) }));
    } finally {
      if (renewTimer) clearInterval(renewTimer);
      release?.();
      await deps.threads.releasePendingHopLease(threadId, runnerId);
    }
  }

  /** 这一棒搁了多久:以线程最后一条消息为准,没消息则以建线程时间为准。 */
  async function hopAgeMs(threadId: string, createdAt: string): Promise<number> {
    const messages = await deps.messages.list(threadId);
    const at = messages[messages.length - 1]?.createdAt ?? createdAt;
    return Date.now() - new Date(at).getTime();
  }

  /** 一次只捡一棒:开机时几条线程都搁着棒,不要同时叫醒好几只猫。 */
  async function sweep(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      const pending = (await deps.threads.list()).filter((t) => t.pendingHop);
      write(formatTurnLog('resume sweep', { n: pending.length }));
      for (const thread of pending) {
        const ageMs = await hopAgeMs(thread.id, thread.createdAt);
        if (staleAfterMs > 0 && ageMs > staleAfterMs) {
          write(formatTurnLog('resume skip', { thread: thread.id, ageMs: Math.round(ageMs) }));
          continue;
        }
        await run(thread.id);
      }
    } finally {
      sweeping = false;
    }
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  function start(): void {
    stop();
    void sweep();
    if (sweepIntervalMs) {
      timer = setInterval(() => {
        void sweep();
      }, sweepIntervalMs);
      timer.unref();
    }
  }

  return { run, sweep, start, stop };
}
