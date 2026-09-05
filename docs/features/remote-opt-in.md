# 本地是默认,碰远程要显式开

- 状态:`已落地`
- 对照 clowder:**没有这个开关**。他们公开的默认世界就是猫 commit → push → `gh pr create` → 过 merge-gate → 自己 `gh pr merge`(`docs/SOP.md`、F031、F140);人的闸只卡**方向**(F083 Design Gate)和**不可逆**(SOP 五轴:删除、force push、合第三方 PR);F246 Approval Hub 的普查表里**根本没有** push / 开 PR / merge 这几项。他们自己在 [issue #1241](https://github.com/zts212653/clowder-ai/issues/1241) 承认现状是「agent 会把『看看 / 修一下』理解成可以 push 和开 PR」,提案还停在 `needs-maintainer-decision`。
- 靠拢:能靠两条 ——(1)**可选能力默认关、显式才开**(`SETUP.md` Optional Features:语音 / 飞书 / LAN 都是 opt-in);(2)**F133 KD-3「先 `register_pr_tracking` 再轮询」,不是见仓就查**,这条正好指着我们现在的毛病:绑仓即每跳无条件 `gh pr list`,比他们还激进。**本刀把人的闸从「不可逆」前移到「出仓」,是刻意偏离**,不是对齐 —— 理由就是他们 #1241 自己描述的那个现象。实现上**不走换 `HOME` 那条路**(LL-019 / LL-020 补了六轮回退了)。

## 门(各一句)

- **功能**:人能绑一个真实仓库、让猫只在本地改和提交,平台一次网络调用都不发;要推送和开 PR 时在建线程时勾一下。
- **价值**:人不用为了「不碰远程」而放弃绑仓退回空沙箱,也不用每跳去读一条毫无意义的「查不到 PR 状态」。
- **愿景**:仍是邮差 —— 平台不代猫 push,只决定**准不准**出仓、以及出仓了要不要停。
- **落点**:`shared/system-prompt.ts`(那句授权)、`router/turn/segment.ts` 的 `recordPrState`(那次 `gh` 调用)、`services/git.ts` 的 `describeGitMoves`(多一种越界)。不新开心脏。

## 为什么

不做成开关,现在是两个都不对的默认:

**平台替人联网,没得选。** `recordPrState` 的门槛只有 `if (!input.thread.repo) return`。绑了仓就每跳跑一次 `gh pr list`。查失败那条路**不去重**(去重只在成功那侧),所以绑一个**没有 remote 的本地仓** —— 一个完全正常的用法 —— 会每跳收一条「查不到 PR 状态(no git remotes found)」。已在 `/tmp` 实测:`gh pr list` 在无 remote 的仓里输出 `no git remotes found` 并失败。

**提示词无条件授权。** 绑仓分支那句原话是「可以 push 你自己这根,也可以对自己这根开 PR」,对所有绑仓线程生效。真实模型拿到许可有倾向去用,这正是 #1241 描述的现象。

还有一层:如果本地模式只改提示词,那它就是**社会性约定假装成技术闸门** —— 正是这个项目一路在拆的东西(`push-boundary.md` 那刀拆的就是「提示词说不许推」)。所以本地模式下猫真推了,必须被看见并停下。

## 他们非推不可的理由,在我们这儿不存在

查过他们公开文档,推在那边担三个结构性职责,逐条对我们:

| 他们为什么推 | 依据 | 我们这边 |
|---|---|---|
| 云端 Codex 那层审查的投递面:先 push + 开 PR,再在 PR **comment** 里 `@codex review` | `cat-cafe-skills/merge-gate/SKILL.md`、F140 | 没有云端猫。审查官在同一台机器上读同一个工作区 |
| `origin/main` 当多猫公告板:开 worktree 前必须与 `origin/main` 同步,共享状态 unpushed 直接停调用 | `cat-cafe-skills/worktree/SKILL.md`、F073 R2/P3、`shared-rules.md` §14 | 猫顺序交接、同一个工作区,靠线程消息和交接包共享 |
| GitHub PR 事件总线:CI 追踪、冲突自动 rebase、review 回写、Repo Inbox 全挂 PR | F133、F140、F141 | 我们只有每跳一次 `gh pr list`,正是本刀要拆的那句 |

**跨 session 不丢工作,他们写的是 commit 不是 push**(`shared-rules.md` §5「Write ≠ 持久化」;LL-011 那条「先 push 再删 worktree」是合入后的清理顺序,不是备份策略,公开文档里没有「没推就丢了工作」的条目)。绑仓线程的提交进的是真仓 object store,本地就是持久的。**本地模式不缺持久化。**

私有仓的质量门他们也写明本地够用:F217 最终结论把私有仓的 self-hosted CI 砍了,强制力靠「main-green 纪律 + 本地 gate/hook + 跨猫 review 家规」,只有公开仓才用 GitHub CI,理由是外部贡献者的本地 hook 不可信。

**所以本刀不是「我们比他们保守」,是他们那三个理由我们一个都没有。** 出仓第二层审查挂在这个开关上,见 [second-layer-review.md](second-layer-review.md):开了远程就不自动落地。

## 怎么做

1. **线程带一个字段**:`thread.repo.allowRemote?: boolean`。**字段缺失 = 本地**(现有 22 条线程自动落到安全那侧,其中两条绑仓线程会不再查 PR —— 这是想要的,那条 semver 线程的 PR 查询本来就已经坏了)。建线程接口接受这个字段。

2. **提示词分两种**:本地时那句换成「只在本地提交,不许推送、不许开 PR」;开了远程才是现在这句。

3. **本地时完全跳过 PR 查询**:`recordPrState` 开头加 `if (!thread.repo.allowRemote) return`。一次 `gh` 都不跑,一条 notice 都不落。

4. **本地时推送算越界**:`describeGitMoves` 收到 `allowRemote: false` 且 `remoteTrackingSha` 变了,产出一条 `git-overstep`(复用现有 kind,不新开),按现有那套处理 —— 参与球权、清掉 pending、不建审批卡。**注意这只抓「从本工作区推出去」**:别处推动远端时本地跟踪引用不会动(我们不 `fetch`),抓不到也不该抓。

5. **越界闸和 git-move 一个字都不改**。`baseLocalSha` 读本地 `refs/heads/<baseBranch>`,不依赖 remote,所以本地模式下猫碰基准分支照样当场拦。**本地模式不会让边界变松。**

6. **UI 一个勾选框**:仓库路径旁边,默认不勾,文案点明会联网。线程列表里那条仓库信息要能看出这条线程是哪种模式 —— 不能让模式变成隐形状态。

**验收**:
- 绑一个没有 remote 的本地仓、发一句话 → 全程**零**「查不到 PR 状态」(现在是每跳一条),`gh` 一次没跑。
- 同一条线程让猫碰本地基准分支 → 照样 `git-overstep` 停下。
- 记分板新增一行「本地模式下猫偷偷推了」,量的是第 4 步那道关,期望 1。已有 `merge-pr` / `void-after-merge` / `push-base` 三行要在 harness 里显式 `allowRemote: true`,否则会因为默认变了而假绿。
- 协议表(`AGENTS.md` 平台自己做的)那条「绑仓线程每跳后自己查这个分支的 PR」改成「开了远程的绑仓线程」。

## 不做(本篇)

- **全局默认配置项**。只做线程级。全局开关会让「以后建的线程都能推」变成隐形状态,跟这一刀的诉求正相反。
- **裁 git 子进程的 env / 技术上拿走凭据**。`repo-root-allowlist.md` 已经论证过不裁的理由;LL-019 / LL-020 也写明动 `HOME` 那条路会炸。本地模式是**授权 + 网络**开关,不是凭据沙箱。
- **给已有线程改模式**。建线程时定,之后不改。要换就新开一条。

## 入口

- 字段:`packages/shared/src/types.ts` `ThreadRepo.allowRemote`（缺失 = 本地）
- 建线程:`packages/api/src/http/server.ts` `POST /api/threads` 收 `allowRemote`;store 只在 `true` 时写入
- 提示词分叉:`packages/shared/src/system-prompt.ts`
- 跳过 PR 查询:`packages/api/src/router/turn/segment.ts` `recordPrState`
- 本地推送算越界:`packages/api/src/services/git.ts` `describeGitMoves`（`side: 'push'`,kind 仍是 `git-overstep`）
- 调用方把模式传进去:`packages/api/src/router/turn/segment.ts` `recordGitMove`
- 勾选框和列表模式:`packages/web/components/ThreadSidebar.tsx`、`packages/web/lib/threads.ts` `threadRepoHint`
- 记分板:`scripts/eval.ts` `local-push`;fake:`scripts/fixtures/fake-push-local.mjs`
