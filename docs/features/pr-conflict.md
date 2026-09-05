# PR 合不进去时流回线程

一篇只写**一个**可验收的特性。写完就做这一刀,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一刀能靠多近。能靠就靠;本刀没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F140 追踪层轮询已注册 PR 的冲突;发现冲突叫醒去处理。自动 rebase 是他们更后的一层。
- 靠拢:去重指纹、投成功才推进、「有冲突才叫醒写手」。不另起轮询器——挂在现有「每跳后查 OPEN PR」上,和评论 / CI 同一拍。不做自动 rebase。

## 门（各一句）

- **功能**：绑仓开远程的线程里,开着的 PR 变成合不进去,自己出现在时间线,并叫醒写手。冲突解开只记一笔,不叫醒。
- **价值**：人不用盯 GitHub 的「This branch has conflicts」。
- **愿景**：邮差看见合不进去,该叫醒才叫醒。不替猫 rebase。
- **落点**：`services/pr.ts` 加 mergeable 查询;`recordPrState` 的 `onOpenPr` 顺带比对;`settleTurn` 冲突才起一跳。新 `systemKind: pr-conflict`,不参与球权。

## 为什么

CI 红了会流回来,基准分支往前走导致合不进去还是瞎的。演示「猫开了 PR」时面试官问有冲突怎么办,现在只能说人自己去看。对照他们:发现冲突叫醒;自动 rebase 另算。喵窝第一版只检测、只叫醒,不代劳 git。

## 怎么做

1. `gh pr view <number> --json mergeable`。`CONFLICTING` 算冲突,`MERGEABLE` 算解开,`UNKNOWN` 不落(避免刷屏)。
2. 指纹记上次落地的 mergeable。投成功才写 `seenPrMergeable`。
3. 变成冲突:时间线一条 `pr-conflict`,链已停则叫醒写手(四条护栏与评论 / CI 相同)。评论或 CI 叫醒已占槽则本轮不覆盖。
4. 从冲突变成可合:落「冲突解开了」,不叫醒。
5. 本地模式一次 `gh` 都不跑。merged/closed 不查。
6. 记分板一行:「PR 合不进去了」期望 1(落消息 + 叫醒)。

验收:fake 注入 CONFLICTING → 时间线 `pr-conflict` + 写手被叫醒;本地模式零次查询。

## 不做（本篇）

- 自动 rebase / 自动解冲突
- webhook 常驻轮询

## 入口

- 查询 / 文案:`packages/api/src/services/pr.ts` `lookupPrMergeable` / `parsePrMergeableJson`
- 每跳同步:`packages/api/src/router/turn/segment.ts` `syncPrConflict`
- 冲突叫醒:`packages/api/src/router/turn/settle.ts`
- 指纹:`ThreadRepo.seenPrMergeable`
- 记分板:`pr-conflict`
