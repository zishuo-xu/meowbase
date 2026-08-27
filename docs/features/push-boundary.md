# 放开推送，越界就停

一篇只写**一个**可验收的特性。做完再开下一篇。

- 状态:`已落地`
- 对照 clowder:闭环**主语是猫**——猫在自己的 feature worktree 里 `commit`、`git push`、`gh pr create`,过完跨猫 review 和机器门禁后自己 `gh pr merge --squash`。平台不代劳任何一步。人的闸**不在出仓**,在方向(Design Gate)和**不可逆**(改 main 历史、合第三方 PR、close feat、碰圣域);他们的审批中心 F246 清单里没有 push / PR / merge。空间墙写在 **F140 AC-C6**:「只操作 feature worktree,绝不碰 main/runtime,操作超时 abort」。**LL-090** 把口径收准:自己拥有的 feature 分支上 `--force-with-lease` 不算不可逆越权,禁的是改写 main / 共享分支 / 他人工作——**看动的是谁的东西,不看命令名带不带 force**。
- 靠拢:三条照抄语义。①主语交给猫,平台不代劳 push;②人的闸不落在每次出仓,落在不可逆——喵窝的「跨猫 review + 机器门禁」已经有了(审查官结论 + 六道闸),不必再为 push 造一道人工闸;③F140 那面空间墙照抄。**一处比他们严**:他们的墙靠 SOP 纪律,而他们自己的 [issue #63](https://github.com/zts212653/clowder-ai/issues/63) 记着四只猫都没建 worktree、直接在主目录 `checkout -b`——纪律型墙会破,所以这一刀把墙做成机器闸(越界就停接力、球给人、审计留证)。

## 门（各一句）

- **功能**：猫可以把自己那根 `meow/<threadId>` 真的推到 origin;一旦碰基准分支,接力当场停、球回人手里、审计留一行带 sha
- **价值**：代码第一次能出这台机器,人不用手工代推猫的成果;「不许碰 main」不再是提示词里一句没人核的话
- **愿景**：仍是邮差。平台不替猫 push、不评判该不该推,只在越界时停下把球交给人
- **落点**：`system-prompt.ts` 那句禁令改口 + 已有的 `describeGitMoves` 越界信号接进 `settleTurn` 的停接力路径 + 记分板加一行。不新开第二心脏

## 为什么

**现在是最坏的组合:既没拦住,也没允许。** 提示词第 78 行写着「不许 push、不许切分支、不许动 `.git`、不许碰 `<baseBranch>`」,但那只是一句嘱咐:绑仓线程里猫的 CLI 是 `bypassPermissions`,工作目录就是 worktree,而 worktree 按 git 的设计和父仓**共享同一个 `.git`**——远端地址和凭据都在里面。上一刀([git-state-tracking.md](git-state-tracking.md))装了眼睛,所以今天猫真推了平台**看得见**,会在时间线落一句 `⚠️ 基准分支 main 的远端引用变了`——**然后接力照跑**。写下来了,没人管。

两头都不占:想拦的没拦住,想放的没放开,而错误会继续往下传。

**为什么放开而不是收紧。** 要做成事前闸,只有一条路:把凭据从猫手里拿走(换 `HOME` / `GIT_CONFIG`)。他们试过,**LL-019 / LL-020**:替换 `HOME` 隔离 CLI 配置之后 401、模型回落、session 丢失、MCP 工具链残缺、project trust 丢失,连打 6 个补丁仍不稳定,最后**回退**;LL-020 还留下一条判据——同一功能补丁数 > 3 是「方向不对」的信号。所以事前闸这条路在他们那儿已经走烂过一次,不值得我们再走。

**诚实说清这一刀的性质:它是事后闸,不是事前闸。** 越界那一 push 已经发生了,平台做的是**立刻停住、不让它继续扩散**,并留下可查的证据。这比今天的「记一句然后照跑」强,但它不是「拦得住」。要真拦得住得先有身份和凭据代持,那是另一颗心脏,不在这一刀。

对齐他们哪一条:F140 AC-C6 的空间墙 + LL-090 的判据(看对象不看命令名)。做成自己的薄片:墙是机器闸不是纪律,而且只做「停」,不做他们的自动 rebase、不做 PR。

## 怎么做

1. **提示词改口**。`system-prompt.ts` 绑仓那句从「不许 push」改成:可以 `push` 你自己这根 `meow/<threadId>`;不许碰 `<baseBranch>`、不许动 `.git`、不许切分支。**说清哪根是「你自己的」**——LL-090 的判据是对象,提示词里就得点名对象。

2. **越界判定按对象收准**。已有的 `describeGitMoves` 里三种信号,重新分成两类:
 - **不越界**:自己那根分支的本地 `HEAD` 前进、自己那根的远端跟踪引用前进(含被 force 改写)。照旧只落 `git-move`,接力继续。
 - **越界**:基准分支的远端跟踪引用变了,或**本地** `refs/heads/<baseBranch>` 动了(比如 `git branch -f main`)。

 后一条现在**探测不到**:`GitStateSnapshot` 只有 `baseRemoteTrackingSha`,没有本地基准分支的 sha,要加一个字段(一行 `tryRun ['rev-parse', 'refs/heads/<base>']`)。加它的理由正是 worktree 的设计:worktree 和父仓**共享同一套 refs**,所以从线程 workdir 里 `rev-parse refs/heads/main` 看见的就是人主仓那根 main——能看见,才拦得住。

3. **越界就停**。`settleTurn` 里:本跳判出越界 → 落一条系统句(参与球权,球给人)、清掉 `pendingHop` 不再往下交棒、**不建审批卡**(那不是「要不要落地」的问题,是越界)。人开口才继续。

4. **审计留证**。越界那条要能从 `GET /api/audit` 查到,`meta` 带 `baseBranch` 和 before / after sha——事后要能回答「它到底把 main 推成了什么」。按现有约定走 store 装饰器,不手写 `audit.append`。

5. **记分板加一行**。新坏毛病「猫去推基准分支」,fake CLI 造这个动作,期望兜住 1。按踩坑第 27 条**按关分行**:这一行只量「越界拉闸」这道关,不要和别的信号合并成一行,否则墙坏了记分板照样绿。

6. **验收**。绑仓线程:猫推自己那根 → 时间线出「推到了 origin」、接力照跑;猫推基准分支 → 接力当场停、顶栏「球在人手里」、`GET /api/audit` 有一行带两个 sha。反向验:把越界判定改成永远 false,记分板那一行掉到 0(掐点写 `RV` 记号,见踩坑第 28 条)。

## 不做（本篇）

- **不做 `gh pr create` / PR 追踪 / review 回流**。那是他们的 F141(发现:webhook + 5 分钟补偿扫描)+ F140(追踪:注册后轮询、`intent=review|merge` 决定 CI 绿要不要叫醒、`wakePolicy` 决定 Bot 评语吵不吵)。整整一层,单独一篇。他们为这层的分层踩了三个月锅,不能顺手带。
- **不裁 git / gh 子进程的 env**。理由和出处见 [repo-root-allowlist.md](repo-root-allowlist.md)「不做」那节。
- **不解析猫打了什么 git 命令**。只看结果(哪根引用动了),这正是 LL-090 的判据。想靠命令名拦 `--force` 会两头落空:自己分支上的 `--force-with-lease` 被误拦,而绕过的写法拦不住。

## 入口

- 提示词改口:`packages/shared/src/system-prompt.ts`（`buildSystemPrompt` 绑仓那句）
- 快照 + 分类:`packages/api/src/services/git.ts`（`snapshotGitState` 的 `baseLocalSha`、`isGitOverstep`、`describeGitMoves`）
- 每跳后记录不越界、越界先于交棒:`packages/api/src/router/turn/segment.ts`（`recordGitMove` / `captureGit`）
- 越界就停:`packages/api/src/router/turn/settle.ts`（`settleTurn`）
- 球权认 `git-overstep`:`packages/web/lib/ball.ts`
- 记分板:`scripts/eval.ts`（`push-base`）+ `scripts/fixtures/fake-push-base.mjs`
- 协议:见 `AGENTS.md` 协议表「平台自己做的」越界就停那一行
