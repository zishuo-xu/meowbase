import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import { executeTurn, followPendingChain } from '../src/router/execute-turn.js';
import { gitWorktreeAdd } from '../src/services/git.js';
import { DEFAULT_AGENTS } from '../src/config.js';
import { auditApprovals, auditMessages } from '../src/stores/audit-log.js';
import type { AgentService } from '../src/providers/types.js';
import type { AgentId } from '@meowbase/shared';
import type { PrLookup, PrSnapshot } from '../src/services/pr.js';

const exec = promisify(execFile);

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function initScratchRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'scratch', private: true, type: 'module' }, null, 2),
  );
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

function stub(agentId: AgentId, reply: string): AgentService {
  return {
    agentId,
    async runTurn() {
      return { sessionId: `s-${agentId}`, content: reply, status: 'completed' };
    },
  };
}

async function bindThread() {
  const repo = mkdtempSync(join(tmpdir(), 'meowbase-void-repo-'));
  const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-void-work-'));
  cleanups.push(repo, workdirBase);
  await initScratchRepo(repo);
  const raw = createMemoryStores();
  const stores = {
    ...raw,
    messages: auditMessages(raw.messages, raw.audit),
    approvals: auditApprovals(raw.approvals, raw.audit),
  };
  const thread = await stores.threads.create({
    title: 'approval-void',
    primaryAgentId: 'claude',
    workdirBase,
    repo: { path: repo, baseBranch: 'main' },
  });
  await gitWorktreeAdd(repo, thread.workdir, thread.repo!.branch, 'main');
  return { repo, stores, thread, audit: raw.audit };
}

const openPr: PrSnapshot = {
  number: 12,
  state: 'OPEN',
  url: 'https://github.com/example/repo/pull/12',
  headRefOid: 'b'.repeat(40),
};

const mergedPr: PrSnapshot = {
  number: 12,
  state: 'MERGED',
  url: 'https://github.com/example/repo/pull/12',
  headRefOid: 'c'.repeat(40),
};

const closedPr: PrSnapshot = {
  number: 12,
  state: 'CLOSED',
  url: 'https://github.com/example/repo/pull/12',
  headRefOid: 'd'.repeat(40),
};

function lookupOf(pr: PrSnapshot | null): PrLookup {
  return async () => ({ ok: true, pr });
}

function writerThen(reply: string): AgentService {
  let hops = 0;
  return {
    agentId: 'claude',
    async runTurn(input) {
      hops += 1;
      writeFileSync(join(input.workdir, hops === 1 ? 'sum.ts' : 'again.txt'), `v${hops}\n`);
      return {
        sessionId: `s-w-${hops}`,
        content: hops === 1 ? `${reply}\n@闪闪 请审查` : reply,
        status: 'completed',
      };
    },
  };
}

describe('pr-merged 作废还开着的审批卡', () => {
  it('先建卡再合:卡变 voided,notice 写清哪张卡和 PR,审计只一行 approval-voided', async () => {
    const { stores, thread, audit } = await bindThread();
    const registry = createAgentRegistry([
      writerThen('写好了 sum.ts。'),
      stub('gemini', '审查意见:通过'),
    ]);
    const first = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 写个 sum',
      context: first,
    });
    await followPendingChain({ threadId: thread.id, context: first });

    const before = await stores.approvals.list(thread.id);
    expect(before).toHaveLength(1);
    expect(before[0]?.status).toBe('reviewing');
    const cardId = before[0]!.id;

    const second = {
      stores,
      registry,
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(mergedPr),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 再看一眼',
      context: second,
    });

    const after = await stores.approvals.get(cardId);
    expect(after?.status).toBe('voided');
    expect(after?.voidReason).toBe('PR #12 已合并');

    const rows = await stores.messages.list(thread.id);
    const notices = rows.filter(
      (m) => m.role === 'system' && m.systemKind === 'notice' && m.content.includes(cardId),
    );
    expect(notices.some((m) => m.content === `📋 审批卡片 ${cardId} 已失效(PR #12 已合并)`)).toBe(
      true,
    );
    expect(rows.some((m) => m.systemKind === 'pr-merged')).toBe(true);

    const voidedAudit = (await audit.list({ threadId: thread.id })).filter(
      (r) => r.action === 'approval-voided',
    );
    expect(voidedAudit).toHaveLength(1);
    expect(voidedAudit[0]?.meta).toMatchObject({
      approvalId: cardId,
      voidReason: 'PR #12 已合并',
    });
  });

  it('git-overstep 不停着的卡,不作废', async () => {
    const { repo, stores, thread } = await bindThread();
    const bare = mkdtempSync(join(tmpdir(), 'meowbase-void-over-'));
    cleanups.push(bare);
    await exec('git', ['init', '--bare', '-q'], { cwd: bare });
    await exec('git', ['remote', 'add', 'origin', bare], { cwd: repo });
    await exec('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });

    const registry = createAgentRegistry([
      writerThen('写好了。'),
      stub('gemini', '审查意见:通过'),
    ]);
    const first = { stores, registry, agents: DEFAULT_AGENTS, lookupPr: lookupOf(openPr) };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 先写',
      context: first,
    });
    await followPendingChain({ threadId: thread.id, context: first });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.status).toBe('reviewing');

    let pushed = false;
    const overstepper: AgentService = {
      agentId: 'claude',
      async runTurn(input) {
        if (!pushed) {
          writeFileSync(join(input.workdir, 'over.txt'), 'x\n');
          const fake = (
            await exec('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'moved-base'], {
              cwd: input.workdir,
            })
          ).stdout.trim();
          await exec('git', ['push', '-q', 'origin', `${fake}:refs/heads/main`], { cwd: input.workdir });
          pushed = true;
        }
        return { sessionId: 's-over', content: '推了基准分支。', status: 'completed' };
      },
    };
    const second = {
      stores,
      registry: createAgentRegistry([overstepper, stub('gemini', '不该来')]),
      agents: DEFAULT_AGENTS,
      lookupPr: lookupOf(openPr),
    };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 推一下',
      context: second,
    });

    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.systemKind === 'git-overstep')).toBe(true);
    expect(rows.some((m) => m.systemKind === 'pr-merged')).toBe(false);
    expect((await stores.approvals.get(card!.id))?.status).toBe('reviewing');
    expect(rows.some((m) => m.content.includes('已失效'))).toBe(false);
  });

  it('PR CLOSED 不作废还开着的卡', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([
      writerThen('写好了。'),
      stub('gemini', '审查意见:通过'),
    ]);
    const first = { stores, registry, agents: DEFAULT_AGENTS, lookupPr: lookupOf(openPr) };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 先写',
      context: first,
    });
    await followPendingChain({ threadId: thread.id, context: first });
    const card = (await stores.approvals.list(thread.id))[0];
    expect(card?.status).toBe('reviewing');

    const second = { stores, registry, agents: DEFAULT_AGENTS, lookupPr: lookupOf(closedPr) };
    await executeTurn({
      threadId: thread.id,
      content: '@墨墨 再看一眼',
      context: second,
    });

    expect((await stores.approvals.get(card!.id))?.status).toBe('reviewing');
    const rows = await stores.messages.list(thread.id);
    expect(rows.some((m) => m.systemKind === 'pr-merged')).toBe(false);
    expect(rows.some((m) => m.content.includes('已失效'))).toBe(false);
  });

  it('#approve 失效卡在提交之前就拒,卡仍是 voided', async () => {
    const { stores, thread } = await bindThread();
    const registry = createAgentRegistry([stub('claude', 'x')]);
    writeFileSync(join(thread.workdir, 'sum.ts'), 'export const n = 1\n');
    await exec('git', ['add', 'sum.ts'], { cwd: thread.workdir });
    const card = await stores.approvals.create({
      threadId: thread.id,
      writerAgentId: 'claude',
      reviewerAgentId: 'gemini',
      diffText: 'd',
      diffStat: 'sum.ts | 1 +',
    });
    await stores.approvals.setReviewComment(card.id, '通过');
    await stores.approvals.void(card.id, 'PR #12 已合并');
    const logBefore = (await exec('git', ['-C', thread.workdir, 'log', '--oneline'])).stdout;

    const final = await executeTurn({
      threadId: thread.id,
      content: `#approve ${card.id}`,
      context: { stores, registry, agents: DEFAULT_AGENTS },
    });

    expect(final.content).toBe(`⚠️ 这张卡已失效:${card.id}（PR #12 已合并）`);
    expect(final.systemKind).toBe('notice');
    expect((await stores.approvals.get(card.id))?.status).toBe('voided');
    const logAfter = (await exec('git', ['-C', thread.workdir, 'log', '--oneline'])).stdout;
    expect(logAfter).toBe(logBefore);
    expect(logAfter).not.toContain(`approve ${card.id}`);
  });
});
