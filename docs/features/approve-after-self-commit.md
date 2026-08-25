# 猫自己提交之后，批准算什么

- 状态:`已落地`
- 对照 clowder:他们的闸放在**合并**那一侧 —— 猫自己 commit、自己 push，人审的是「这段历史要不要进主干」，平台不替猫造提交。
- 靠拢:这一刀把「批准」从「平台替猫造一个 commit」改成「承认卡上这段历史已经被人看过」，和他们同侧。没更近的地方:合并仍是人在 GitHub 上点，平台不替人合 PR。

## 门（各一句）

- **功能**:猫自己提交推送之后，人点批准不再报「提交失败」;卡上那段改动被记成已落地。
- **价值**:球不再卡在一张「点了就报错」的卡上 —— 现在人点完还得自己去确认到底落没落。
- **愿景**:仍是邮差。平台不替人决定合不合，只如实记「人看过了」。
- **落点**:`services/git.ts` 的 `run` / `gitErrorReason`，`tryLandApproval` 的兜底不动。不新开心脏。

## 为什么

`tryLandApproval` 本来就写了正确的兜底:绑仓、工作区干净、HEAD 已越过 marker，就承认改动已经在历史上、算落地。但这条路**永远走不到**，两个缺陷叠着:

1. git 把「没东西可提交」写在 **stdout**，而 `gitErrorReason` 只读 stderr（实测 stderr 是空的）。
2. 就算读了 stdout 也白读 —— git 输出**跟着系统语言飘**。中文机器上是「无文件要提交，工作区干净」，而 `isNothingToCommit` 匹配的是英文 `nothing to commit`。

以前猫不自己提交，所以从没走到这条路。改成猫自己 commit + push 之后，**每张卡点批准都必报失败**。

这个 bug 有个恶劣的性质:**它跟环境有关**。英文 locale 的机器上碰不到，中文机器上必现。所以「在我这儿是好的」不构成证据。同理，CI 里 git 说英文，**拿真 git 写的集成测试即使不修也会绿** —— 这是本篇测试设计要绕开的坑。

## 怎么做

1. `run()` 给 git 子进程钉 `LC_ALL=C`（其余 env 照旧继承，凭据面不动 —— 那是另一篇的事）。这是根因防线:locale 一钉住，中文那条分支就不可能再出现。
2. `gitErrorReason` 除 stderr 外也看 stdout。第 1 步之后它不再是必需，但 git 把可读原因写 stdout 是常态，留着它才能把原因如实报给人。
3. `tryLandApproval` 不改。它的判断是对的，只是够不着。
4. 测试三层，第一层才是真防线:
   - 断言 `run` 起 git 时带 `LC_ALL=C`（**不依赖跑测试那台机器的语言**）
   - 单测 `gitErrorReason` 能从 stdout 取原因、`isNothingToCommit` 认得英文那句
   - 绑仓集成:猫自己提交后 `#approve` 落 `approval-applied`，不是 `approval-failed`
5. 验收:在**中文 locale** 的机器上，绑仓线程里让猫自己提交，点 `#approve`，时间线出「已落地」而不是「批准记下了，但提交失败」。

## 不做（本篇）

- 不裁 git 子进程的 env、不动凭据透传。本篇只**加**一个 `LC_ALL`，不减任何东西。
- 不改「批准」在 PR 语义下要不要顺手合 PR。合仍然是人在 GitHub 上做。
- 不给记分板加行。这不是一道关，是解析正确性;真防线是第 4 步第一条那个断言，加进记分板反而会因为 CI 说英文而假绿。

## 入口

- 钉 locale / 读 stdout:`packages/api/src/services/git.ts`（`gitChildEnv` / `run` / `gitErrorReason`）。`tryLandApproval` / `isNothingToCommit` 判断没改
- 单测:`packages/api/test/git.test.ts`（`LC_ALL=C`、stdout 取因、英文 nothing to commit）
- 绑仓集成:`packages/api/test/git-state-tracking.test.ts`（猫自己提交后 `#approve` 落 `approval-applied`）
