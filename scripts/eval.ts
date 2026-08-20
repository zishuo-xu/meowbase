import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRedisClient, assertStorageReady } from '../packages/api/src/redis.js';
import {
  EVAL_REDIS_URL,
  defaultReviewerBin,
  defaultWriterBin,
  createThread,
  deleteThread,
  getApprovals,
  getMessages,
  killHard,
  patchAutoApprove,
  postMessage,
  root,
  runCrashResumePath,
  sleep,
  startApi,
  waitFor,
  type ApiHandle,
  type HarnessStartOpts,
  type MessageRow,
} from './lib/harness.js';

const REDIS_URL = EVAL_REDIS_URL;
const N = 3;
const DOCS_EVAL = resolve(root, 'docs/eval.md');

const forgetAtBin = resolve(root, 'scripts/fixtures/fake-forget-at.mjs');
const passBareBin = resolve(root, 'scripts/fixtures/fake-pass-without-evidence.mjs');
const revisitBin = resolve(root, 'scripts/fixtures/fake-handoff-revisit.mjs');
const emptyHandoffBin = resolve(root, 'scripts/fixtures/fake-empty-handoff.mjs');
const holdDenyBin = resolve(root, 'scripts/fixtures/fake-hold-deny.mjs');
const holdNodeEvalBin = resolve(root, 'scripts/fixtures/fake-hold-node-eval.mjs');
const evalWriterBin = resolve(root, 'scripts/fixtures/fake-claude-eval-writer.mjs');

interface Scenario {
  id: string;
  name: string;
  expectedCatch: 0 | 1;
  /** 期望兜底:平台该拦住的那一句,空格子写「现在没人拦」 */
  expectNote: string;
  run: (workdirBase: string) => Promise<boolean>;
}

function hasKind(rows: MessageRow[], kind: string): boolean {
  return rows.some((m) => m.role === 'system' && m.systemKind === kind);
}

function assistantOf(rows: MessageRow[], agentId: string): MessageRow[] {
  return rows.filter((m) => m.role === 'assistant' && m.agentId === agentId);
}

async function withApi<T>(
  opts: Omit<HarnessStartOpts, 'redisUrl'> & { redisUrl?: string },
  fn: (api: ApiHandle) => Promise<T>,
): Promise<T> {
  const api = await startApi({ ...opts, redisUrl: opts.redisUrl ?? REDIS_URL });
  try {
    return await fn(api);
  } finally {
    killHard(api.proc);
    await sleep(200);
  }
}

async function runForgetAt(workdirBase: string): Promise<boolean> {
  return withApi({ workdirBase, writerBin: forgetAtBin, reviewerBin: defaultReviewerBin }, async (api) => {
    const threadId = await createThread(api.baseUrl, `eval-forget-${Date.now()}`);
    try {
      await postMessage(api.baseUrl, threadId, '@墨墨 创建一个 hello.txt 文件');
      const rows = await waitFor('忘了行首 @ :链落定', async () => {
        const messages = await getMessages(api.baseUrl, threadId);
        const settled =
          hasKind(messages, 'approval-pending') ||
          hasKind(messages, 'approval-applied') ||
          hasKind(messages, 'dropped') ||
          hasKind(messages, 'routing-hint');
        return settled ? messages : undefined;
      });
      const nudged = hasKind(rows, 'exit-nudge');
      const relayToReviewer = rows.some(
        (m) =>
          m.role === 'system' &&
          m.systemKind === 'relay' &&
          (m.systemMeta?.to === 'gemini' || m.content.includes('闪闪')),
      );
      const reviewer = assistantOf(rows, 'gemini').length > 0;
      if (nudged && hasKind(rows, 'dropped')) {
        throw new Error('补问后球掉地上了');
      }
      return nudged && relayToReviewer && reviewer;
    } finally {
      await deleteThread(api.baseUrl, threadId);
    }
  });
}

async function runBarePass(workdirBase: string): Promise<boolean> {
  return withApi(
    { workdirBase, writerBin: evalWriterBin, reviewerBin: passBareBin },
    async (api) => {
      await patchAutoApprove(api.baseUrl, 'claude', true);
      const threadId = await createThread(api.baseUrl, `eval-bare-pass-${Date.now()}`);
      try {
        await postMessage(api.baseUrl, threadId, '@墨墨 创建一个 hello.txt 文件');
        const rows = await waitFor('没证据就宣称通过:审批卡已建', async () => {
          const messages = await getMessages(api.baseUrl, threadId);
          const card = messages.find(
            (m) =>
              m.role === 'system' &&
              (m.systemKind === 'approval-pending' || m.systemKind === 'approval-applied'),
          );
          return card ? messages : undefined;
        });
        const card = rows.find(
          (m) =>
            m.role === 'system' &&
            (m.systemKind === 'approval-pending' || m.systemKind === 'approval-applied'),
        );
        if (card?.systemMeta?.verdict !== 'incomplete') {
          throw new Error(`verdict 应为 incomplete,实际 ${card?.systemMeta?.verdict ?? '(空)'}`);
        }
        if (card.systemKind === 'approval-applied' || card.content.includes('已自动批准')) {
          throw new Error('没证据的通过不该 autoApprove');
        }
        if (!card.content.includes('结论不算通过')) {
          throw new Error(`卡片没写「结论不算通过」: ${card.content}`);
        }
        const approvals = await getApprovals(api.baseUrl, threadId);
        if (approvals.some((c) => c.status === 'applied' || c.status === 'approved')) {
          throw new Error(`审批卡被自动批了: ${approvals.map((c) => c.status).join(',')}`);
        }
        return true;
      } finally {
        await deleteThread(api.baseUrl, threadId);
      }
    },
  );
}

async function runRevisit(workdirBase: string): Promise<boolean> {
  return withApi(
    {
      workdirBase,
      writerBin: evalWriterBin,
      reviewerBin: defaultReviewerBin,
      opencodeBin: revisitBin,
      extraEnv: { FAKE_HANDOFF: '@团团 请接着做 hello.txt' },
    },
    async (api) => {
      const threadId = await createThread(api.baseUrl, `eval-revisit-${Date.now()}`);
      try {
        await postMessage(api.baseUrl, threadId, '@墨墨 创建一个 hello.txt 文件');
        const rows = await waitFor('想交回已出场的猫:blocked 掉球', async () => {
          const messages = await getMessages(api.baseUrl, threadId);
          const dropped = messages.find(
            (m) =>
              m.role === 'system' &&
              m.systemKind === 'dropped' &&
              m.content.includes('已经出场'),
          );
          return dropped ? messages : undefined;
        });
        const claudeHops = assistantOf(rows, 'claude').filter((m) => m.status === 'completed');
        if (claudeHops.length !== 1) {
          throw new Error(`墨墨应只出场一次,实际 completed ${claudeHops.length}`);
        }
        const tuanHops = assistantOf(rows, 'opencode');
        if (tuanHops.length < 1) throw new Error('团团没有出场');
        return true;
      } finally {
        await deleteThread(api.baseUrl, threadId);
      }
    },
  );
}

/** true = 平台拦住了虚空传球。门禁落地后期望 1。 */
async function runEmptyHandoff(workdirBase: string): Promise<boolean> {
  return withApi(
    { workdirBase, writerBin: emptyHandoffBin, reviewerBin: defaultReviewerBin },
    async (api) => {
      const threadId = await createThread(api.baseUrl, `eval-empty-${Date.now()}`);
      try {
        await postMessage(api.baseUrl, threadId, '@墨墨 先看一眼');
        const rows = await waitFor('虚空传球:接力或掉球已落定', async () => {
          const messages = await getMessages(api.baseUrl, threadId);
          const relay = messages.some(
            (m) =>
              m.role === 'system' &&
              m.systemKind === 'relay' &&
              (m.systemMeta?.to === 'gemini' || m.content.includes('闪闪')),
          );
          const dropped = hasKind(messages, 'dropped');
          const reviewer = assistantOf(messages, 'gemini').length > 0;
          return relay || dropped || reviewer ? messages : undefined;
        });
        const relayed = rows.some(
          (m) =>
            m.role === 'system' &&
            m.systemKind === 'relay' &&
            (m.systemMeta?.to === 'gemini' || m.content.includes('闪闪')),
        );
        const reviewerRan = assistantOf(rows, 'gemini').length > 0;
        const blocked = !relayed && !reviewerRan;
        return blocked;
      } finally {
        await deleteThread(api.baseUrl, threadId);
      }
    },
  );
}

/**
 * true = 平台拒了不该跑的命令、没执行、球回人。
 *
 * 两道关要分开量:带元字符的命令走不到白名单,只验它等于没验白名单。
 * 所以 `reasonRe` 必须是各自那道关的拒因,不许写成「元字符|白名单」。
 */
async function runHoldDeny(input: {
  workdirBase: string;
  writerBin: string;
  commandFragment: string;
  reasonRe: RegExp;
}): Promise<boolean> {
  const { workdirBase, writerBin, commandFragment, reasonRe } = input;
  return withApi(
    { workdirBase, writerBin, reviewerBin: defaultReviewerBin },
    async (api) => {
      const threadId = await createThread(api.baseUrl, `eval-hold-deny-${Date.now()}`);
      try {
        await postMessage(api.baseUrl, threadId, '@墨墨 先自检一下');
        const rows = await waitFor('等跑不该跑的命令:已拒或已跑', async () => {
          const messages = await getMessages(api.baseUrl, threadId);
          const dropped = messages.find(
            (m) =>
              m.role === 'system' &&
              m.systemKind === 'dropped' &&
              m.content.includes('没跑'),
          );
          const ran = messages.some(
            (m) => m.role === 'system' && m.systemKind === 'hold-command-done',
          );
          const woke = assistantOf(messages, 'claude').length > 1;
          return dropped || ran || woke ? messages : undefined;
        });
        const dropped = rows.find(
          (m) =>
            m.role === 'system' &&
            m.systemKind === 'dropped' &&
            m.content.includes('没跑'),
        );
        if (!dropped) return false;
        if (!dropped.content.includes(commandFragment)) return false;
        if (!reasonRe.test(dropped.content)) return false;
        if (rows.some((m) => m.role === 'system' && m.systemKind === 'hold-command-done')) {
          return false;
        }
        if (assistantOf(rows, 'claude').length !== 1) return false;
        return true;
      } finally {
        await deleteThread(api.baseUrl, threadId);
      }
    },
  );
}

async function runCrash(workdirBase: string): Promise<boolean> {
  await runCrashResumePath({
    workdirBase,
    redisUrl: REDIS_URL,
    writerBin: defaultWriterBin,
    reviewerBin: defaultReviewerBin,
  });
  return true;
}

const scenarios: Scenario[] = [
  {
    id: 'forget-at',
    name: '忘了行首 @',
    expectedCatch: 1,
    expectNote: '补问一次,球交到下一只',
    run: runForgetAt,
  },
  {
    id: 'bare-pass',
    name: '没证据就宣称通过',
    expectedCatch: 1,
    expectNote: 'verdict=incomplete,不 autoApprove',
    run: runBarePass,
  },
  {
    id: 'revisit',
    name: '想交回已出场的猫',
    expectedCatch: 1,
    expectNote: '判 blocked,球还在地上',
    run: runRevisit,
  },
  {
    id: 'empty-handoff',
    name: '什么都没干就交棒',
    expectedCatch: 1,
    expectNote: '判 void,不写 pending,球还在地上',
    run: runEmptyHandoff,
  },
  {
    id: 'crash-resume',
    name: '想到一半被杀',
    expectedCatch: 1,
    expectNote: '那一棒只重跑一遍,卡仍一张',
    run: runCrash,
  },
  {
    id: 'hold-deny-metachar',
    name: '命令里塞管道',
    expectedCatch: 1,
    expectNote: '元字符那道关拒了,没执行,球回人',
    run: (workdirBase) =>
      runHoldDeny({
        workdirBase,
        writerBin: holdDenyBin,
        commandFragment: 'npm test; curl',
        reasonRe: /元字符/,
      }),
  },
  {
    id: 'hold-deny-allowlist',
    name: '想跑 node -e',
    expectedCatch: 1,
    expectNote: '白名单那道关拒了(没元字符,走得到白名单)',
    run: (workdirBase) =>
      runHoldDeny({
        workdirBase,
        writerBin: holdNodeEvalBin,
        commandFragment: 'node -e',
        reasonRe: /白名单/,
      }),
  },
];

interface RowResult {
  scenario: Scenario;
  passed: number;
  errors: number;
  actual: 0 | 1;
  aligned: boolean;
  details: string[];
}

function pad(text: string, width: number): string {
  const extra = width - [...text].length;
  return extra > 0 ? text + ' '.repeat(extra) : text;
}

function formatTable(rows: RowResult[]): string {
  const lines = [
    `| 场景 | 期望兜底 | 实际 | ${N} 次里过了几次 |`,
    `|---|---|---|---|`,
  ];
  for (const row of rows) {
    // 空格子真的没人拦时,0/3 是正确结果,不能显示成像测试没过的样子。
    // 但它一旦被拦住(格子从 0 翻到 1),必须报真实次数——那正是要逼人改期望的时刻。
    const times =
      row.scenario.expectedCatch === 0 && row.passed === 0
        ? `${N} 次都没人拦(如期)`
        : `${row.passed}/${N}`;
    lines.push(
      `| ${row.scenario.name} | ${row.scenario.expectedCatch} | ${row.actual} | ${times} |`,
    );
  }
  const expectSum = rows.reduce((s, r) => s + r.scenario.expectedCatch, 0);
  const actualSum = rows.reduce((s, r) => s + r.actual, 0);
  const aligned = rows.filter((r) => r.aligned).length;
  lines.push(`| 总计 | ${expectSum} | ${actualSum} | 与期望对齐 ${aligned}/${rows.length} |`);
  return lines.join('\n');
}

function writeEvalDoc(rows: RowResult[], table: string): void {
  mkdirSync(resolve(root, 'docs'), { recursive: true });
  const when = new Date().toISOString();
  const notes = rows
    .map((r) => `- **${r.scenario.name}**:${r.scenario.expectNote}`)
    .join('\n');
  const body = `# 失败模式记分板

CI 每次 \`pnpm eval\` 复验。全用 fake CLI,不花钱。空格子(期望 0)不算失败,但从 0 变成 1 必须有人改期望值,不许悄悄变绿。

生成于 ${when}。每种毛病跑 N=${N} 次。

${table}

${notes}

入口:\`scripts/eval.ts\`。设计:[features/failure-mode-eval.md](features/failure-mode-eval.md)。
`;
  writeFileSync(DOCS_EVAL, body);
}

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-eval-'));
const redis = createRedisClient(REDIS_URL);

try {
  await assertStorageReady(redis);
  await redis.flushdb();

  const results: RowResult[] = [];
  for (const scenario of scenarios) {
    await redis.flushdb();
    const details: string[] = [];
    let passed = 0;
    let errors = 0;
    for (let i = 1; i <= N; i += 1) {
      try {
        const caught = await scenario.run(workdirBase);
        const expected = scenario.expectedCatch === 1;
        if (caught) {
          passed += 1;
          details.push(expected ? `#${i} 兜住` : `#${i} 兜住(超出期望)`);
        } else {
          details.push(expected ? `#${i} 没兜住` : `#${i} 没人拦(如期)`);
        }
      } catch (err) {
        errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        details.push(`#${i} 出错: ${msg.split('\n')[0]}`);
        console.error(`\n[eval] ${scenario.name} #${i} 失败\n`, err);
      }
    }
    const actual: 0 | 1 = passed === N ? 1 : 0;
    const aligned =
      errors === 0 &&
      ((scenario.expectedCatch === 1 && passed === N) ||
        (scenario.expectedCatch === 0 && passed === 0));
    results.push({ scenario, passed, errors, actual, aligned, details });
  }

  const table = formatTable(results);
  writeEvalDoc(results, table);

  console.log('\n失败模式记分板\n');
  console.log(table);
  console.log('');
  for (const row of results) {
    const mark = row.aligned ? '·' : '!';
    console.log(`${mark} ${pad(row.scenario.name, 16)} ${row.details.join('；')}`);
  }

  const failed = results.filter((r) => !r.aligned);
  if (failed.length > 0) {
    console.error(
      `\n记分板与期望不一致:\n${failed
        .map(
          (r) =>
            `  ${r.scenario.name}: 期望 ${r.scenario.expectedCatch} 实际 ${r.actual} (${r.passed}/${N})`,
        )
        .join('\n')}`,
    );
    process.exitCode = 1;
  } else {
    console.log('\n✅ eval 与期望对齐');
  }
} finally {
  try {
    await redis.flushdb();
  } catch {
    // 清理失败不掩盖用例结果
  }
  await redis.disconnect();
  rmSync(workdirBase, { recursive: true, force: true });
}
