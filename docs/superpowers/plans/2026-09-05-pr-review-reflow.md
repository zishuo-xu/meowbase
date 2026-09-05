# PR 评论流回线程 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 绑仓开远程的线程里,PR 上的 review 评论自动落到线程时间线;人写的评论叫醒写手猫去处理,bot 写的只展示。

**Architecture:** 挂在现有「每跳后查 PR」(`recordPrState`)上:PR 是 OPEN 就多拉一次评论列表(issues/comments + pulls/reviews),按线程上持久化的已见 id 指纹去重,新评论先落系统消息、落成功才推进指纹;人写的新评论在 `settleTurn` 给写手猫 setPendingHop(复用 hold-command 叫醒的现成模式),pending-runner 接着跑。不开第二个轮询器。

**Tech Stack:** TypeScript ESM(NodeNext,相对导入带 .js)、Fastify、vitest。无新依赖。

## Global Constraints

- 设计稿:`docs/features/pr-review-reflow.md`,口径以它为准
- **一刀一次提交**:所有任务都不 commit,六道闸全绿后由控制者一次提交,commit 标题 `feat: PR 上的评论流回线程`
- **不碰** `meowbase.config.json`、`docs/eval.md`;改了 `packages/shared` 必须 `pnpm --filter @meowbase/shared build`(tsx watch 盯 dist,不 build 不生效)
- 新增系统消息必须带 `systemKind`(判别联合,append 不带 kind 编译不过);审计不用手写,store 边界自动落
- 本地模式(`thread.repo.allowRemote` 缺失)一次 `gh` 都不多跑——所有新逻辑在 `recordPrState` 的 allowRemote 早退之后
- 指纹 `seenPrCommentIds` 只在消息 append 成功后更新;append 抛错则不推进,下轮重投
- 只有 `authorType === 'User'` 的评论叫醒猫;Bot/Other 只落消息
- 测试号段注意:api 报告数不等于 `it(` 声明数(有参数化用例);改 AGENTS.md 测试数按 vitest 实际输出写
- 新 fake CLI 文件必须 `chmod +x` 并确认 git 记 100755(本计划不新增 fake CLI,复用 env 假源)

---

### Task 1: 线程记评论指纹 + 新系统消息类型

**Files:**
- Modify: `packages/shared/src/types.ts`(ThreadRepo 加字段、SystemKind 加 kind)
- Modify: `packages/api/src/stores/ports.ts`(ThreadStore 加 setter)
- Modify: `packages/api/src/stores/memory.ts`、`packages/api/src/stores/redis.ts`(实现 setter)
- Test: `packages/api/test/stores-memory.test.ts`、`packages/api/test/redis-stores.test.ts`

**Interfaces:**
- Produces:
  - `ThreadRepo.seenPrCommentIds?: string[]`(已回流入库的 PR 评论 id)
  - `SystemKind` 新增 `'pr-review'`
  - `ThreadStore.setSeenPrCommentIds(threadId: string, ids: string[]): Promise<void>`

- [ ] **Step 1: 写失败测试**

`packages/api/test/stores-memory.test.ts` 里仿照「lastApprovedSha 写入后 get 能 round-trip」加:

```ts
it('seenPrCommentIds 写入后 get 能 round-trip', async () => {
  const stores = createMemoryStores();
  const repoPath = mkdtempSync(join(tmpdir(), 'meow-test-'));
  const thread = await stores.threads.create({
    title: 't', primaryAgentId: 'claude',
    repo: { path: repoPath, baseBranch: 'main', allowRemote: true },
  });
  await stores.threads.setSeenPrCommentIds(thread.id, ['c9001', 'r42']);
  const got = await stores.threads.get(thread.id);
  expect(got?.repo?.seenPrCommentIds).toEqual(['c9001', 'r42']);
  // 不覆盖其他 repo 字段
  expect(got?.repo?.allowRemote).toBe(true);
});
```

`packages/api/test/redis-stores.test.ts` 的「线程 repo 绑定写入并回读」旁边加同语义的 Redis 版(用该文件现成的线程创建方式,断言 `seenPrCommentIds` round-trip)。

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @meowbase/api test stores-memory`
Expected: FAIL — setSeenPrCommentIds 不存在

- [ ] **Step 3: 实现**

`packages/shared/src/types.ts`:
- `ThreadRepo`(L37-45)加字段:`/** 已回流过的 PR 评论 id;投成功的才记,投丢下轮再投 */ seenPrCommentIds?: string[];`
- `SystemKind`(L52-72)在 `'pr-merged'` 后加 `| 'pr-review'`(带注释 `/** PR 评论回流:不参与球权,叫醒靠 pendingHop */`)

`packages/api/src/stores/ports.ts` ThreadStore 加(放在 setLastApprovedSha 后):

```ts
/** PR 评论回流的指纹;只在消息落库成功后更新 */
setSeenPrCommentIds(threadId: string, ids: string[]): Promise<void>;
```

`memory.ts` 与 `redis.ts` 照 `setLastApprovedSha` 的先例实现:读出线程,`thread.repo = { ...thread.repo, seenPrCommentIds: ids }`,Redis 版再 `hset(threadKey(threadId), 'repo', JSON.stringify(thread.repo))`;线程没有 repo 时不动。

- [ ] **Step 4: 重建 shared,跑测试确认绿**

Run: `pnpm --filter @meowbase/shared build && pnpm --filter @meowbase/api test stores`
Expected: PASS(含 Redis 套件;本地 Redis 在跑)

### Task 2: 评论拉取与纯函数(pr.ts)

**Files:**
- Modify: `packages/api/src/services/pr.ts`
- Test: 新建 `packages/api/test/pr-review.test.ts`

**Interfaces:**
- Consumes: 现有 `GH_TIMEOUT_MS`、`classifyPrLookupError`、`exec`(promisify 的 execFile)
- Produces(后面任务用这些名字,不许改):
  - `PrReviewItem { id: string; author: string; authorType: 'User' | 'Bot' | 'Other'; body: string; htmlUrl?: string; submittedAt?: string }`(id 跨来源唯一:issue comment 前缀 `c`,review 前缀 `r`)
  - `PrReviewListResult = { ok: true; items: PrReviewItem[] } | { ok: false; reason: string }`
  - `PrReviewList = (input: { workdir: string; number: number }) => Promise<PrReviewListResult>`
  - `parsePrReviewJson(rawComments: string, rawReviews: string): PrReviewItem[] | null`
  - `selectUnseenPrReviews(items: readonly PrReviewItem[], seenIds: readonly string[]): PrReviewItem[]`
  - `formatPrReviewNote(input: { author: string; body: string; number: number; url: string }): string`
  - `formatPrReviewWakeTask(input: { comments: readonly PrReviewItem[]; number: number; url: string }): string`
  - `createOpenPrLookup(): PrLookup`(记分板假源:固定 OPEN 的 PR #42,headRefOid 取真 HEAD)
  - `createFixedPrReviewList(kind: 'user' | 'bot'): PrReviewList`(固定吐一条评论)
  - `listPrReviews(input: { workdir: string; number: number; ghBin?: string }): Promise<PrReviewListResult>`

- [ ] **Step 1: 写失败测试** `packages/api/test/pr-review.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  createFixedPrReviewList,
  formatPrReviewNote,
  formatPrReviewWakeTask,
  parsePrReviewJson,
  selectUnseenPrReviews,
} from '../src/services/pr.js';

const COMMENTS = JSON.stringify([
  { id: 9001, body: '边界条件没处理', user: { login: 'reviewer-hr', type: 'User' },
    html_url: 'https://github.com/example/repo/pull/42#issuecomment-9001', created_at: '2026-09-05T00:00:00Z' },
  { id: 9002, body: '覆盖率 +2%', user: { login: 'codecov-bot', type: 'Bot' } },
]);
const REVIEWS = JSON.stringify([
  { id: 77, body: '整体可以,小改一处', user: { login: 'boss', type: 'User' },
    html_url: 'https://github.com/example/repo/pull/42#pullrequestreview-77', submitted_at: '2026-09-05T01:00:00Z' },
  { id: 78, body: '   ', user: { login: 'boss', type: 'User' } }, // 空 body 的 review 丢弃
]);

describe('parsePrReviewJson', () => {
  it('合并 issue comments 和 reviews,id 加来源前缀,作者类型归三档', () => {
    const items = parsePrReviewJson(COMMENTS, REVIEWS);
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.id)).toEqual(['c9001', 'c9002', 'r77']);
    expect(items![0]).toMatchObject({ author: 'reviewer-hr', authorType: 'User', htmlUrl: expect.stringContaining('issuecomment-9001') });
    expect(items![1]!.authorType).toBe('Bot');
  });
  it('任一输入不是 JSON 返回 null', () => {
    expect(parsePrReviewJson('not json', REVIEWS)).toBeNull();
    expect(parsePrReviewJson(COMMENTS, '{}')).toBeNull();
  });
});

describe('selectUnseenPrReviews', () => {
  it('过滤掉已见 id', () => {
    const items = parsePrReviewJson(COMMENTS, REVIEWS)!;
    expect(selectUnseenPrReviews(items, ['c9001', 'r77']).map((i) => i.id)).toEqual(['c9002']);
    expect(selectUnseenPrReviews(items, [])).toHaveLength(3);
  });
});

describe('format', () => {
  it('评论消息带作者和 PR 号', () => {
    const note = formatPrReviewNote({ author: 'reviewer-hr', body: '边界条件没处理', number: 42, url: 'https://x' });
    expect(note).toContain('reviewer-hr');
    expect(note).toContain('42');
    expect(note).toContain('边界条件没处理');
  });
  it('叫醒任务逐条带评论', () => {
    const items = parsePrReviewJson(COMMENTS, REVIEWS)!;
    const task = formatPrReviewWakeTask({ comments: items.filter((i) => i.authorType === 'User'), number: 42, url: 'https://x' });
    expect(task).toContain('reviewer-hr');
    expect(task).toContain('boss');
    expect(task).not.toContain('codecov-bot');
  });
});

describe('createFixedPrReviewList', () => {
  it('user/bot 各吐一条对应类型的评论', async () => {
    const user = await createFixedPrReviewList('user')({ workdir: '/tmp', number: 42 });
    const bot = await createFixedPrReviewList('bot')({ workdir: '/tmp', number: 42 });
    expect(user.ok && user.items[0]!.authorType).toBe('User');
    expect(bot.ok && bot.items[0]!.authorType).toBe('Bot');
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `pnpm --filter @meowbase/api test pr-review`
Expected: FAIL — 导出不存在

- [ ] **Step 3: 实现**(追加到 `packages/api/src/services/pr.ts`)

类型与纯函数按上面 Interfaces 的签名;`parsePrReviewJson` 要点:两个输入都 `JSON.parse` 且必须是数组否则 null;comment 缺 `id`(number)或 `body`(string)跳过;review 的 body 全空白跳过(approve 时常空);`authorType` 只认 `'User'`/`'Bot'`,其余归 `'Other'`。

`listPrReviews` 真实现:

```ts
export async function listPrReviews(input: { workdir: string; number: number; ghBin?: string }): Promise<PrReviewListResult> {
  const bin = input.ghBin ?? 'gh';
  try {
    const { stdout: nwo } = await exec(bin, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: input.workdir, timeout: GH_TIMEOUT_MS });
    const repo = nwo.trim();
    if (!repo) return { ok: false, reason: '拿不到仓库名' };
    const [{ stdout: rawComments }, { stdout: rawReviews }] = await Promise.all([
      exec(bin, ['api', `repos/${repo}/issues/${input.number}/comments`], { cwd: input.workdir, timeout: GH_TIMEOUT_MS }),
      exec(bin, ['api', `repos/${repo}/pulls/${input.number}/reviews`], { cwd: input.workdir, timeout: GH_TIMEOUT_MS }),
    ]);
    const items = parsePrReviewJson(rawComments, rawReviews);
    if (!items) return { ok: false, reason: '返回不是 JSON' };
    return { ok: true, items };
  } catch (err) {
    return { ok: false, reason: classifyPrLookupError(err) };
  }
}
```

`createOpenPrLookup` 照 `createMergedPrLookup`(L165-185)改成 `state: 'OPEN'`。`createFixedPrReviewList` 固定返回:`{ id: 'c9001', author: kind === 'user' ? 'reviewer-hr' : 'codecov-bot', authorType: kind === 'user' ? 'User' : 'Bot', body: '这里的边界条件没处理,除零要炸', htmlUrl: 'https://github.com/example/repo/pull/42#issuecomment-9001', submittedAt: '2026-09-05T00:00:00Z' }`。

- [ ] **Step 4: 跑确认绿**

Run: `pnpm --filter @meowbase/api test pr-review`
Expected: PASS

### Task 3: 接线 + 检测 + 叫醒

**Files:**
- Modify: `packages/api/src/router/turn/types.ts`(TurnContext、SegmentRunResult)
- Modify: `packages/api/src/app.ts`、`packages/api/src/http/server.ts`(注入缝,照 lookupPr 先例)
- Modify: `packages/api/src/router/turn/segment.ts`(recordPrState 加 onOpenPr 回调;captureAfterHop 收集)
- Modify: `packages/api/src/router/turn/settle.ts`(叫醒)
- Test: `packages/api/test/execute-turn.test.ts`(或同目录新文件 `pr-review-flow.test.ts`)

**Interfaces:**
- Consumes: Task 2 的 `listPrReviews` / `selectUnseenPrReviews` / `formatPrReviewNote` / `formatPrReviewWakeTask` / `PrReviewItem`;Task 1 的 `setSeenPrCommentIds`、`'pr-review'` kind
- Produces:
  - `TurnContext.listPrReviews?: PrReviewList`
  - `PrReviewRef = { item: PrReviewItem; prNumber: number; prUrl: string }`(定义在 services/pr.ts 并导出)
  - `SegmentRunResult.prReviews?: PrReviewRef[]`
  - `syncPrReviews(input: { thread: ThreadRuntime; context: TurnContext; writeQueue: WriteQueue; pr: PrSnapshot }): Promise<PrReviewItem[]>`(segment.ts 内,可不导出)

- [ ] **Step 1: 写失败测试**(集成,走 executeTurn 全链,memory stores + stub adapter;参考现有「绑仓」用例的搭法)

四个用例:
1. **人写的评论叫醒写手猫**:线程绑仓 `allowRemote: true`;注入 `lookupPr` 返回 OPEN PR #42、`listPrReviews` 返回一条 User 评论。发一条消息让 stub 猫改文件(有 diff)但不交棒(链停,否则 `waiting` 护栏会压住叫醒——这正是要锁的行为,另加一例:stub 交棒时本轮只落 `pr-review` 消息、不设 pendingHop)。断言:消息列表有 `systemKind === 'pr-review'` 且含作者名;`threads.get` 的 `pendingHop.to` 是写手猫、task 含评论正文;`thread.repo.seenPrCommentIds` 含 `c9001`。
2. **bot 评论只落消息不叫醒**:同上但 Bot 评论。断言:有 `pr-review` 消息;`pendingHop` 为空。
3. **指纹去重**:用例 1 之后再发一条消息。断言:`pr-review` 消息仍只有 1 条。
4. **本地模式零调用**:线程 `allowRemote` 缺失;`listPrReviews` 传一个被调用就 throw 的 stub。断言:不抛、无 `pr-review` 消息。

- [ ] **Step 2: 跑确认红**

Run: `pnpm --filter @meowbase/api test pr-review-flow`
Expected: FAIL

- [ ] **Step 3: 实现**

a) `types.ts`(router/turn):`TurnContext` 加 `listPrReviews?: PrReviewList`(import type 自 services/pr.ts);`SegmentRunResult` 加 `prReviews?: PrReviewRef[]`。

b) `app.ts` / `server.ts` 照 `lookupPr` 的缝(app.ts L26 声明、L74 默认;server.ts L93 deps、L549 createTurnContext)加 `listPrReviews`,默认 `listPrReviews` 真实现。

c) `segment.ts`:
- `recordPrState` 入参加 `onOpenPr?: (pr: PrSnapshot) => Promise<void>`;在 merged 分支之后、`samePr('pr-opened', pr)` 早退**之前**插:`if (pr.state === 'OPEN' && input.onOpenPr) await input.onOpenPr(pr);`(CLOSED 不查;merged 已由上面的分支收敛)
- 新函数 `syncPrReviews`(签名见 Interfaces):
  - `pr.state !== 'OPEN'` 直接 `return []`(双保险)
  - `const list = input.context.listPrReviews ?? listPrReviews`;try/catch + `!result.ok` 都落 `systemKind: 'notice'` 消息(`formatPrLookupFailedNote(reason)` 复用)并返回 `[]`
  - `seen = input.thread.repo?.seenPrCommentIds ?? []`,`fresh = selectUnseenPrReviews(result.items, seen)`,空则返回 `[]`
  - 逐条 `writeQueue(() => stores.messages.append({ ..., role: 'system', systemKind: 'pr-review', content: formatPrReviewNote({ author, body, number: pr.number, url: item.htmlUrl ?? pr.url }), systemMeta: { prNumber: pr.number, prUrl: pr.url } }))`,**append 成功才把 id push 进 delivered;append 抛错就让异常冒上去,delivered 之前的不丢**(writeQueue 串行,异常即中断,指纹不更新)
  - 循环后 `await stores.threads.setSeenPrCommentIds(thread.id, [...seen, ...delivered])`,返回 `fresh.filter((i) => delivered.includes(i.id))`
- `captureAfterHop`:给 `recordPrState` 传 `onOpenPr`,回调里 `const delivered = await syncPrReviews(...)` 并 `for (const item of delivered) collected.push({ item, prNumber: pr.number, prUrl: pr.url })`;收集盒的名字照 `oversteps`/`mergedPr` 的现有攒法,最后进 `SegmentRunResult.prReviews`

d) `settle.ts`:在越界/合并早退块之后、读 `pending` 之前插叫醒块:

```ts
// 放在现有「读 pending、算 waiting/holding」之后,建卡块之前;沿用已算好的 waiting/holding
const humanReviews = (lastResult.prReviews ?? []).filter((r) => r.item.authorType === 'User');
let wokeForReview = false;
if (lastOutput.status === 'completed' && humanReviews.length > 0 && !waiting && !pending?.holdCommand) {
  const writerAgentId = chainFirstAgent ?? thread.primaryAgentId;
  const first = humanReviews[0]!;
  await context.stores.threads.setPendingHop(threadId, {
    id: randomUUID(),
    to: writerAgentId,
    from: writerAgentId,
    task: formatPrReviewWakeTask({
      comments: humanReviews.map((r) => r.item),
      number: first.prNumber,
      url: first.prUrl,
    }),
    goal: '处理 PR 上的新评论',
    previousOutput: lastOutput.content ?? '',
    visited: [writerAgentId],
    firstAgent: writerAgentId,
    hop: 0,
  });
  wokeForReview = true;
  turnLog('pr-review wake', { thread: threadId, to: writerAgentId, count: humanReviews.length });
}
```

(顶部 `import { randomUUID } from 'node:crypto';`,formatPrReviewWakeTask 从 services/pr.js 引入。)

三条护栏,条条有原因:
- **不能放在 pending 读取之前**:`waiting === true`(链还要继续,槽里是交接的下一棒)时不许覆盖——交接的棒比叫醒重要,覆盖了等于把猫的交棒吃掉
- **`pending?.holdCommand` 存在时不叫醒**:槽里搁着一条「等跑」的命令,覆盖了命令就永远没人跑;等跑完那一跳猫自然会从时间线看到评论
- **建卡块的执行条件追加 `&& !wokeForReview`**:叫醒和建卡同一轮只能出一个,不然卡上冻结的是处理评论之前的旧 diff,审查等处理评论那一跳跑完再建

已知边界(写进功能稿「不做」一节):评论恰好卡在接力链中段到达时,指纹已在那一跳推进、settle 时槽里有棒,本轮只落消息不叫醒;叫醒语义只对「链已停」的线程保证。

- [ ] **Step 4: 跑确认绿 + 全量 api 测试**

Run: `pnpm --filter @meowbase/api test`
Expected: PASS(新 4 例 + 原有全绿)

### Task 4: 前端球权跳过 pr-review

**Files:**
- Modify: `packages/web/lib/ball.ts`
- Test: `packages/web/lib/__tests__/ball.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `'pr-review'` kind(经消息 DTO 的 `systemKind?: string`)

- [ ] **Step 1: 写失败测试**:`ball.test.ts` 加一例——消息序列以 `pr-review` 系统消息结尾时,球权和没有这条消息时一样(它不参与球权)。

- [ ] **Step 2: 跑确认红**

Run: `pnpm --filter @meowbase/web test ball`
Expected: FAIL

- [ ] **Step 3: 实现**:`ball.ts` L46 `pr-opened` 那行下面加:

```ts
if (last.role === 'system' && last.systemKind === 'pr-review') continue;
```

- [ ] **Step 4: 跑确认绿**

Run: `pnpm --filter @meowbase/web test`
Expected: PASS

另:手工核 `parse-message.ts` 的 `isHiddenChatMessage` 不会把 💬 开头的这条吞掉(被吞就调正则,并补一例)。

### Task 5: 记分板两行

**Files:**
- Modify: `scripts/e2e-server.ts`(新 env 缝)
- Modify: `scripts/eval.ts`(两个场景 + 登记表)
- 可能 Modify: `scripts/lib/harness.ts`(若需要新断言 helper)

**Interfaces:**
- Consumes: Task 2 的 `createOpenPrLookup` / `createFixedPrReviewList`;Task 3 的注入缝
- Produces: env `MEOW_PR_REVIEW_FAKE=user|bot`(只在 e2e-server 认,不进 startApp 生产路径)

- [ ] **Step 1: e2e-server.ts 加缝**(照 L13 的 MEOW_PR_FAKE 先例,注释写明假源只在 e2e-server)

```ts
...(process.env.MEOW_PR_REVIEW_FAKE === 'user' || process.env.MEOW_PR_REVIEW_FAKE === 'bot'
  ? {
      lookupPr: createOpenPrLookup(),
      listPrReviews: createFixedPrReviewList(process.env.MEOW_PR_REVIEW_FAKE),
    }
  : {}),
```

- [ ] **Step 2: eval.ts 两个场景**,照 `runMergePr`(L469-505)的搭法,`withBoundApi({ ..., extraEnv: { MEOW_PR_REVIEW_FAKE: 'user' | 'bot' } })`:

- `pr-review-user`「PR 上来了人写的 review」:发消息让写手 fake 干活 → 等链落定 → 断言:有 `systemKind === 'pr-review'` 消息且含 `reviewer-hr`;写手猫的 assistant 消息 ≥ 2 条(被叫醒跑的第二跳);叫醒那一跳的输入里带评论正文(可从消息或审计核对);`pr-review` 消息全程只有 1 条(再发一条人消息验证不重复);审计有 `pr-review` 行
- `pr-review-bot`「PR 上来了 bot 的评论」:断言:有 `pr-review` 消息;写手 assistant 消息只有 1 条(没叫醒);链停后无 `pendingHop`

- [ ] **Step 3: 跑记分板**

Run: `EVAL_ONLY=pr-review pnpm eval`(若不支持按前缀过滤就跑全量 `pnpm eval`)
Expected: 两行期望都是兜住;跑完 `git restore docs/eval.md`

### Task 6: 文档同轮 + 六道闸 + 一次提交

**Files:**
- Modify: `AGENTS.md`(协议表加一行 + 测试数)、`docs/features/pr-review-reflow.md`(状态改已落地 + 入口)、`docs/features/README.md`(行状态)、`docs/ALIGNMENT.md`(第 23 行)、`docs/PROGRESS.md`(现在停在哪 + 增量)

- [ ] **Step 1: `AGENTS.md` 协议表「平台自己做的」加一行**(放在「PR 合了就停」附近):

```
| PR 评论回流 | 绑仓开远程的线程,每跳后 PR 是 OPEN 就拉一次评论(issues/comments + pulls/reviews):新评论落 `pr-review` 系统消息(不参与球权),指纹投成功才记;作者是人(User)则 settle 时给写手猫起一跳去处理,bot 只落消息。merged/closed 后不再查 |
```

测试数按 `pnpm test` 实际输出更新(shared/api/web 三处)。

- [ ] **Step 2: `docs/features/pr-review-reflow.md`**:状态 `设计中` → `已落地`;「不做」一节补一条已知边界:「评论恰好卡在接力链中段到达时,本轮只落消息不叫醒(指纹已推进,不补叫);叫醒只对链已停的线程保证」;「入口」填:`packages/api/src/services/pr.ts`(listPrReviews)、`packages/api/src/router/turn/segment.ts`(syncPrReviews / recordPrState)、`settle.ts`(叫醒)、`packages/web/lib/ball.ts`(球权跳过)。`docs/features/README.md` 表里这行状态同步改。

- [ ] **Step 3: `docs/ALIGNMENT.md`**:第 23 行(F140)状态仍「部分对齐」,括号收窄成「差 CI 追踪、冲突检测」;meowbase 证据列加 [pr-review-reflow](features/pr-review-reflow.md) 链接;建议顺序第 1 条改成只剩 CI 追踪 + 冲突检测;顶部对齐率不变(仍是部分对齐)。

- [ ] **Step 4: `docs/PROGRESS.md`**:「现在停在哪」就地改;增量记录顶部加一条,标题 `feat: PR 上的评论流回线程`,四栏写齐(动了什么 / 与设计稿的偏离 / 只有人手验过的部分:没对真 GitHub 验过 review 拉取 / 留了没做:CI 追踪、冲突检测、自动 rebase)。

- [ ] **Step 5: 六道闸**

```bash
pnpm -r build && pnpm typecheck:scripts && pnpm test && pnpm e2e && pnpm eval
git restore docs/eval.md
pnpm e2e:web   # 沙箱外
```

- [ ] **Step 6: 一次提交**

```bash
git status   # 只含本刀文件;meowbase.config.json、docs/eval.md 不在里面
git add -A packages docs scripts AGENTS.md   # 按实际改动列清楚,别 add 到禁区文件
git commit -m "feat: PR 上的评论流回线程"
```
