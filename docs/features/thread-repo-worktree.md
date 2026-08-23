# 线程绑真实仓库：git worktree 隔离

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:公开 `pnpm start` 写明「auto-creates runtime worktree」,Mission Hub 跨项目跟 feature,GitHub PR 评审能回流到线程 —— 猫干的是真仓库的活,不是空目录里的玩具。
- 靠拢:worktree 这条直接靠,粒度做到**一线程一 worktree 一分支**。差在:不合主干、不开 PR、不跨项目看板,那些以后另开篇。

## 门（各一句）

- **功能**：建线程时给一个真实仓库路径,猫就在那个仓库的独立 worktree 上干活,改动仍走 diff → 互审 → 审批卡
- **价值**：人不用再把猫的产出从空沙箱手抄回项目里;也不用为了让猫看见代码而放它进主工作区
- **愿景**：邮差只管开工作区、认地址、送 diff;合不合进主干是人的事
- **落点**：`Thread.repo` + `services/git.ts` 建/删 worktree + 建线程 HTTP 入口 + `buildSystemPrompt` 写清边界。`executeTurn` 一行不用改

## 为什么

现在每个线程都是 `work/<threadId>` 下一个全新空仓库,只有一个 `package.json` 基线。下游那套 diff → 互审 → 审批 → commit 的机器是真的,喂进去的输入永远是玩具。别人问「能指着我的仓库跑吗」,答案是不能。

反过来,直接让猫进主工作区更糟:三只猫并行改同一棵树,`git diff HEAD` 分不清谁写的,拉闸也救不回来。worktree 正好两头都要:同一个仓库、同一份历史,各自独立的工作区和分支。隔离靠 git,不靠提示词自觉。

## 怎么做

1. `Thread.repo?: { path, baseBranch, branch }`（shared 类型）。`POST /api/threads` 多收可选 `repoPath` + `baseBranch`（缺省取该仓库当前分支）。校验:路径存在、是 git 仓库、`baseBranch` 存在、目标 worktree 路径未被占用;不过则 400,不建线程。（这一刀落地时只有这几道校验;后来在它们**之前**又加了一道根白名单,不在允许的根下面先回 403,见 [repo-root-allowlist.md](repo-root-allowlist.md)。）
2. 绑了仓库:`git -C <repoPath> worktree add <workdirBase>/<threadId> -b meow/<threadId> <baseBranch>`。**不调 `gitInit`** —— 它会往目录里写一份沙箱 `.gitignore`,在真仓库里就是覆盖人家的 `.gitignore`。没绑仓库:完全走现在的 `mkdir` + `package.json` + `gitInit`,旧行为和旧测试一个字不改。
3. 删线程:先 `git -C <repoPath> worktree remove --force <workdir>`,再删目录。`meow/<threadId>` 分支**留着**,人可能还要看;删分支要人自己动手。
4. `buildSystemPrompt` 里写明:这是真实仓库 `<repoPath>` 的 worktree,绝对路径 `<workdir>`,当前分支 `meow/<threadId>`;不许 `push`、不许切分支、不许动 `.git`、不许碰 `baseBranch`。
5. 绑了仓库的线程**跳过 `sweepStrayFiles`**。那条清扫靠「仓库根浅层散落文件」判断,在真仓库里会把人家根目录的真文件搬进 worktree（踩坑 6 的规则只对空沙箱成立）。opencode 已经靠 `--dir` 钉住写入位置。
6. 验收：绑一个真实仓库建线程 → `@墨墨 加个函数` → 审批卡 diff 只含 worktree 内改动 → `#approve` 后 `git log meow/<threadId>` 有这条提交、`git log <baseBranch>` 没有、主工作区 `git status` 干净。不传 `repoPath` 时行为与现在完全一致。

## 不做（本篇）

- 不合主干、不 `push`、不开 PR（`#approve` 仍只提交到线程分支）
- 不做跨项目 Mission Hub / feature 看板
- 不改审批卡、互审、球权、持球任何语义
- 不做同仓库多线程的并发上锁（各自分支、各自 worktree,git 自己拦重复路径）

## 面试能讲

- **30 秒**：多猫改同一个仓库,隔离不靠提示词,靠 git worktree + 每线程独立分支。人只在审批那一步拍板,落地也只落在线程分支上。
- **追问「猫会不会弄坏我的仓库」**：worktree 是独立工作区,分支是 `meow/<threadId>`,主干和 baseBranch 拿不到;审批才提交,不 push。
- **追问「和 clowder 差在哪」**：他们运行时也是 worktree;我们把粒度做到每线程一个,代价是同仓库线程多了要自己回收。
- **踩坑**：`gitInit` 会写沙箱 `.gitignore`,绑真仓库时必须绕开;沙箱清扫的浅层启发式在真仓库里必须关。

## 入口

- 类型:`packages/shared/src/types.ts` `Thread.repo` / `ThreadRepo`
- worktree 帮手:`packages/api/src/services/git.ts` `gitIsRepo` / `gitCurrentBranch` / `gitBranchExists` / `gitWorktreeAdd` / `gitWorktreeRemove` / `gitWorktreeList` / `gitWorktreePrune`
- 建/删:`packages/api/src/http/server.ts` `POST /api/threads`、`DELETE /api/threads/:threadId`
- 绑仓跳过清扫:`packages/api/src/router/turn/agent-hop.ts` `sweepStrayFiles`
- 系统提示边界:`packages/shared/src/system-prompt.ts` `buildSystemPrompt`
- 侧栏建会话输入:`packages/web/components/ThreadSidebar.tsx`
