import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentId, PendingHop } from '@meowbase/shared';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import { cloneAgentSpec, DEFAULT_AGENTS } from '../src/config.js';
import { gitInit } from '../src/services/git.js';
import {
  createPendingRunner,
  type PendingRunner,
} from '../src/router/pending-runner.js';
import type { TurnContext } from '../src/router/turn/types.js';

function stubAgent(agentId: AgentId, reply: string, sessionId = `sess-${agentId}`): AgentService {
  return {
    agentId,
    async runTurn(input) {
      for (const piece of reply) {
        input.onIncrement?.(piece);
      }
      return { sessionId, content: reply, status: 'completed' };
    },
  };
}

function sampleHop(overrides: Partial<PendingHop> = {}): PendingHop {
  return {
    to: 'opencode',
    from: 'claude',
    task: '请审查',
    goal: '写 add.ts',
    previousOutput: '写完了',
    visited: ['claude'],
    firstAgent: 'claude',
    hop: 1,
    ...overrides,
  };
}

const runners: PendingRunner[] = [];

afterEach(() => {
  for (const runner of runners) runner.stop();
  runners.length = 0;
});

function makeRunner(input: {
  stores: ReturnType<typeof createMemoryStores>;
  registry: ReturnType<typeof createAgentRegistry>;
  logs?: string[];
  leaseTtlMs?: number;
  leaseRenewMs?: number;
  sweepIntervalMs?: number;
  staleAfterMs?: number;
}): PendingRunner {
  const runner = createPendingRunner({
    threads: input.stores.threads,
    messages: input.stores.messages,
    createContext: (): { context: TurnContext } => ({
      context: {
        stores: input.stores,
        registry: input.registry,
        agents: DEFAULT_AGENTS.map(cloneAgentSpec),
      },
    }),
    log: input.logs ? (line) => input.logs!.push(line) : undefined,
    leaseTtlMs: input.leaseTtlMs ?? 5_000,
    leaseRenewMs: input.leaseRenewMs ?? 20_000,
    sweepIntervalMs: input.sweepIntervalMs ?? 0,
    staleAfterMs: input.staleAfterMs,
  });
  runners.push(runner);
  return runner;
}

describe('pending-runner', () => {
  it('开机扫:store 里已有 pendingHop 则自己续跑,不追加用户消息', async () => {
    const stores = createMemoryStores();
    const calls: string[] = [];
    const registry = createAgentRegistry([
      stubAgent('claude', '不该来'),
      {
        agentId: 'opencode',
        async runTurn() {
          calls.push('opencode');
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.threads.setPendingHop(thread.id, sampleHop());
    const runner = makeRunner({ stores, registry });
    await runner.sweep();
    expect(calls).toEqual(['opencode']);
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.role === 'assistant' && m.agentId === 'opencode')).toBe(true);
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(0);
  });

  it('两个 run 并发只让模型跑一棒', async () => {
    const stores = createMemoryStores();
    let calls = 0;
    const registry = createAgentRegistry([
      stubAgent('claude', '不该来'),
      {
        agentId: 'opencode',
        async runTurn() {
          calls += 1;
          await new Promise((r) => setTimeout(r, 40));
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.threads.setPendingHop(thread.id, sampleHop());
    const runner = makeRunner({ stores, registry });
    await Promise.all([runner.run(thread.id), runner.run(thread.id)]);
    expect(calls).toBe(1);
  });

  it('别人占着租约时 sweep 不跑这一棒', async () => {
    const stores = createMemoryStores();
    let calls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'opencode',
        async runTurn() {
          calls += 1;
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.threads.setPendingHop(thread.id, sampleHop());
    await stores.threads.claimPendingHop(thread.id, 'other-runner', 60_000);
    const runner = makeRunner({ stores, registry });
    await runner.sweep();
    expect(calls).toBe(0);
    expect((await stores.threads.get(thread.id))?.pendingHop?.to).toBe('opencode');
  });

  it('过期租约会被 sweep 接管', async () => {
    const stores = createMemoryStores();
    let calls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'opencode',
        async runTurn() {
          calls += 1;
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.threads.setPendingHop(thread.id, sampleHop());
    await stores.threads.claimPendingHop(thread.id, 'dead-runner', 15);
    await new Promise((r) => setTimeout(r, 30));
    const runner = makeRunner({ stores, registry });
    await runner.sweep();
    expect(calls).toBe(1);
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
  });

  it('搁太久的棒开机不自己捡,只记一行日志', async () => {
    const stores = createMemoryStores();
    const logs: string[] = [];
    let calls = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'opencode',
        async runTurn() {
          calls += 1;
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.threads.setPendingHop(thread.id, sampleHop());
    const runner = makeRunner({ stores, registry, logs, staleAfterMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    await runner.sweep();
    expect(calls).toBe(0);
    expect((await stores.threads.get(thread.id))?.pendingHop?.to).toBe('opencode');
    expect(logs.some((line) => line.includes('resume skip'))).toBe(true);
  });

  it('几条线程都搁着棒时一次只捡一棒', async () => {
    const stores = createMemoryStores();
    let inFlight = 0;
    let maxInFlight = 0;
    const registry = createAgentRegistry([
      {
        agentId: 'opencode',
        async runTurn() {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
          return { sessionId: 's2', content: '审查通过', status: 'completed' };
        },
      },
    ]);
    for (let i = 0; i < 3; i++) {
      const thread = await stores.threads.create({ title: `t${i}`, primaryAgentId: 'claude' });
      await stores.threads.setPendingHop(thread.id, sampleHop());
    }
    const runner = makeRunner({ stores, registry });
    await runner.sweep();
    expect(maxInFlight).toBe(1);
  });

  it('续跑抛错时 run 仍 resolve,记日志并释放租约', async () => {
    const stores = createMemoryStores();
    const logs: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'opencode',
        async runTurn() {
          throw new Error('provider boom');
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.threads.setPendingHop(thread.id, sampleHop());
    const runner = makeRunner({ stores, registry, logs });
    await expect(runner.run(thread.id)).resolves.toBeUndefined();
    expect(logs.some((line) => line.includes('resume fail') && line.includes('provider boom'))).toBe(
      true,
    );
    expect(await stores.threads.claimPendingHop(thread.id, 'next-runner', 5_000)).toBe(true);
  });

  it('重启后的等跑 hop 只叫醒同一只,不执行命令', async () => {
    const stores = createMemoryStores();
    const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-hold-restart-'));
    const prompts: string[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.prompt);
          return { sessionId: 's1', content: '看到中断了。通过', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({
      title: 't',
      primaryAgentId: 'claude',
      workdirBase,
    });
    mkdirSync(thread.workdir, { recursive: true });
    await gitInit(thread.workdir);
    writeFileSync(join(thread.workdir, 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    const marker = join(thread.workdir, 'side-effect.txt');
    await stores.threads.setPendingHop(
      thread.id,
      sampleHop({
        to: 'claude',
        from: 'claude',
        task: 'node -e "require(\'fs\').writeFileSync(\'side-effect.txt\',\'x\')"',
        holdCommand: "node -e \"require('fs').writeFileSync('side-effect.txt','x')\"",
        previousOutput: '先自检。\n等跑 node -e "require(\'fs\').writeFileSync(\'side-effect.txt\',\'x\')"',
      }),
    );
    const runner = makeRunner({ stores, registry });
    await runner.sweep();
    expect(existsSync(marker)).toBe(false);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('平台重启');
    const messages = await stores.messages.list(thread.id);
    expect(messages.some((m) => m.role === 'system' && m.content.includes('平台重启'))).toBe(true);
    expect(messages.some((m) => m.content.includes('跑完:'))).toBe(false);
    expect((await stores.threads.get(thread.id))?.pendingHop).toBeUndefined();
    rmSync(workdirBase, { recursive: true, force: true });
  });

  it('stop 清掉 interval,不再扫', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '好')]);
    await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    let lists = 0;
    const inner = stores.threads.list.bind(stores.threads);
    stores.threads.list = async () => {
      lists += 1;
      return inner();
    };
    const runner = makeRunner({ stores, registry, sweepIntervalMs: 25 });
    runner.start();
    await new Promise((r) => setTimeout(r, 70));
    runner.stop();
    const afterStop = lists;
    expect(afterStop).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 70));
    expect(lists).toBe(afterStop);
  });
});
