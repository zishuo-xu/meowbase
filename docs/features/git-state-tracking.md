# 平台看得见猫对 git 做了什么

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。

- 状态:`已落地`
- 对照 clowder:他们公开的闭环**主语是猫**——猫在自己的 feature worktree 里 commit、`git push`、`gh pr create`,过门后 `gh pr merge --squash`。平台只绑目录、展示 worktree 和当前分支(F063 / F082)、并**追踪已经存在的 PR** 把 review 回流到开卡那只猫的线程(F140 / F141)。人管愿景和不可逆(force push、合第三方 PR)。
- 靠拢:靠的是**分工**——猫驱动 git,平台治理与追踪。这一刀只做「追踪」那半边,还没放开猫的手,因为我们的平台现在**看不见**猫对 git 做了什么(见下),没有眼睛就放手是耍。他们的 F082 Git Health Panel、F140「只操作 feature worktree,绝不碰 main/runtime」都是本刀的对照物。

## 门（各一句）

- **功能**：猫在绑仓线程里提交、推送、切分支,平台都看得见:时间线出一句,审计留一行。基准分支的远端引用被动过则明确报警
- **价值**：人不用自己 `git log` / `git status` 去查猫干了什么;「不许 push」不再是一句没人核的嘱咐
- **愿景**：仍是邮差。平台不评判猫该不该推,只如实记下发生了什么
- **落点**：`services/git.ts` 加只读探测 + `runSegment` 每跳后比对 + 现有系统消息(新 `systemKind`)。绑仓审批 diff 基准从 `HEAD` 换成 `lastApprovedSha` / `merge-base`。不新开第二心脏

## 为什么

**平台现在瞎。** 判断「本轮有没有改动」走 `gitDiffHead`,也就是 `git diff HEAD`——它只看得见**未提交**的改动。今天没出事,是因为猫被提示词要求不要自己提交。可那句话和「不许 push」一样,只是嘱咐:绑仓线程里猫的 CLI 是 `bypassPermissions`,工作目录就是 worktree,而 worktree 按 git 的设计和父仓**共享同一个 `.git`**——远端地址和凭据都在里面。平台既不拦,也不知道。

猫一旦自己提交,连锁三处一起坏:

1. `gitDiffHead` 变空 → `settleTurn` **不建审批卡**,人以为没改动
2. `listHandoffFiles` 变空 → `shouldNudgeExit` 的 `hasDiff` 变假、`isVoidHandoff` 误判「这一跳什么都没干」,好好的交棒被拦
3. 人点批准时平台去 `gitCommit`,git 报「nothing to commit」→ 被 `catch` 吞掉 → `markApplied` 照样执行 → 回执写「✅ 已批准并落地」

第 3 条今天就是个谎,只是现在很少走到;**放开猫的手之后会经常走到**。所以顺序必须是先装眼睛、再放手。

对齐他们哪一条:F082 把「脏文件、陈旧分支、Orphan Worktree」做成可看的面板,F140 要求自动 git 操作「只操作 feature worktree,绝不碰 main/runtime」。两条的共同前提都是**平台先能观测**。本篇做成自己的薄片:不做面板,只在时间线和审计里落一句。

## 怎么做

1. **只读探测**。`services/git.ts` 加一个函数,对线程 workdir 取一份快照:当前分支、`HEAD` sha、本地远端跟踪引用 `refs/remotes/<remote>/<branch>` 的 sha、基准分支的跟踪引用 sha、以及相对基准分支领先几个 commit。全部只读,**不联网**——`git push` 会顺手更新本地的远端跟踪引用,所以比一比就知道推没推,不必 `fetch`。

2. **每跳后比对**。`runSegment` 跑完一跳、已经算过 `relayFiles` 的地方,顺手取第二份快照和跳前那份比。只在 `thread.repo` 存在时做(空沙箱没有远端,跳过)。

3. **变化落成一句话**。新 `systemKind: 'git-move'`(不参与球权)。分三种:
   - 猫自己提交了 → 「墨墨 在 `meow/<id>` 上提交了 N 个 commit」
   - 远端跟踪引用前进了 → 「墨墨 把 `meow/<id>` 推到了 origin」
   - **基准分支的跟踪引用动了** → 「⚠️ 基准分支 `main` 的远端引用变了」,这是越界,要显眼

4. **审计留行**。`git-move` 走 `messages.append`,装饰器自动落 `action: 'git-move'`,探测处不另写 `safeAppendAudit`。

5. **审批卡改基准**。绑仓线程 `git diff <marker>`(已提交+未提交):marker 是 `lastApprovedSha`,没有则 `merge-base <baseBranch> HEAD`。空沙箱仍走 `git diff HEAD`。批准落地成功后 marker 前进到新 HEAD。

6. **批准不再撒谎**。`gitCommit` 失败(含「nothing to commit」)时**不** `markApplied`:卡停在 `approved`,回执说清原因,球回人手里。**绝不**在批准时补一次 `gitAddAll`——那会把人没在卡上看过的改动一起提交,是把「悄悄没提交」换成「悄悄提交了没批的东西」,严格更糟。

验收:

- 绑仓线程里手动在 worktree 提交一个 commit,再发一句话 → 时间线出「提交了 1 个 commit」,审计有一行
- 手动 `git push` 那条分支 → 出「推到了 origin」
- 手动动一下基准分支的远端引用 → 出带 ⚠️ 的越界句
- **猫自己提交之后,审批卡仍然建得出来**(这条是本刀的主验收,证明平台不再瞎)
- 建卡后清掉暂存区再 `#approve` → 卡不是 `applied`、回执不说「已落地」、球回人
- 空沙箱线程一句 `git-move` 都不出

## 已知边界（这一刀没堵）

`tryLandApproval` 里「工作区干净 + HEAD 已越过 marker → 算落地」那一支,marker 前进到**当前 HEAD**,而不是这张卡当初对应的那个点。所以批准一张**过期的卡**时,卡建出来之后猫又提交的东西会被一起算进「已批准」,下一张卡里不再出现。

复现要人先发一句非 `#approve` 的话让猫再跑一轮并提交、工作区干净,然后回头批那张**旧卡 id**——正常流程里人批的是最新那张,所以很少走到。没堵是因为堵法都有代价:要么给审批卡存一个建卡时的 HEAD sha(建卡时未提交、后来被猫提交的改动会落在它上面,marker 太保守,已批的东西会在下一张卡里再露一次),要么给卡记住自己那份 diff 的范围(要改数据模型)。保守版只是啰嗦,当前版是**少算**——真要堵应该选保守那版。

留在这里,不假装它不存在。

## 不做（本篇）

- **不放开猫的手**。系统提示里「不许 push」这一轮不改。先有眼睛,下一刀再谈把它改成「可以推自己那条分支」
- **不开 PR、不合并、不 `gh`**。他们也是分开的刀:F140 是「PR 开出来之后怎么追」,不是「从工作区一键开 PR」
- **不做 Git Health 面板**。只落时间线一句 + 审计一行,不做 F082 那种面板
- **不加 `repoPath` 根目录白名单**。这是同一片区域的另一个真缺口(他们 F074 有 `PROJECT_ALLOWED_ROOTS`,我们现在能绑本机任意 git 仓),单独一刀

## 入口

- 只读快照:`packages/api/src/services/git.ts`（`snapshotGitState` / `resolveDiffMarker` / `tryLandApproval`）
- 每跳后比对:`packages/api/src/router/turn/segment.ts`（`recordGitMove`）
- 审批 diff 基准:`settle.ts` / `review.ts` / `listHandoffFiles` 共用 `resolveDiffMarker`
- 批准落地:`packages/api/src/router/turn/land-approval.ts`、`system-commands.ts`
- 球权跳过 `git-move`、认 `approval-failed`:`packages/web/lib/ball.ts`
- 协议:见 `AGENTS.md` 协议表「平台自己做的」那一行
