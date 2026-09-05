# PR 上的 CI 变绿变红流回线程

一篇只写**一个**可验收的特性。写完就做这一刀,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一刀能靠多近。能靠就靠;本刀没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F133 / F140 追踪层轮询已注册 PR 的 CI;绿只记状态,红才叫醒去修。
- 靠拢:去重指纹、投成功才推进、「绿不叫醒 / 红叫醒写手」三条直接搬。不另起轮询器——挂在现有「每跳后查 OPEN PR」上,和评论回流同一拍。

## 门（各一句）

- **功能**：绑仓开远程的线程里,开着的 PR 检查变绿或变红,自己出现在时间线;变红则叫醒写手去修。
- **价值**：人不用盯 GitHub Actions 再回来转述。
- **愿景**：邮差看见检查结果,该叫醒才叫醒。
- **落点**：`services/pr.ts` 加检查拉取;`recordPrState` 的 `onOpenPr` 顺带比对;`settleTurn` 红了才起一跳。新 `systemKind: pr-ci`,不参与球权。

## 为什么

评论会流回来了,CI 还是瞎的。演示「猫开了 PR」时面试官问 checks 红了怎么办,现在只能说人自己去看。对照他们:intent=review 时绿只记、红才叫醒。喵窝没有 intent 字段,统一按这个默认——绿不叫醒,红叫醒写手。

## 怎么做

1. `gh pr checks <number> --json name,state,link` 拉检查。PENDING 不落(避免刷屏)。SUCCESS 绿、FAILURE/ERROR/TIMED_OUT 红。
2. 指纹 `name:state`,投成功才记 `seenPrCheckIds`。
3. 绿:时间线一条 `pr-ci`,不叫醒。红:同样落消息,链已停则叫醒写手(四条护栏与评论回流相同)。评论叫醒已占槽则本轮不覆盖。
4. 本地模式一次 `gh` 都不跑。merged/closed 不查。
5. 记分板两行:「PR 上的 CI 红了」期望 1(落消息 + 叫醒);「PR 上的 CI 绿了」期望 1(落消息、不叫醒)。

验收:fake 注入 FAILURE → 时间线 `pr-ci` + 写手被叫醒;注入 SUCCESS → 只落消息;本地模式零次查询。

## 不做（本篇）

- 冲突检测 / 自动 rebase
- 按 intent 决定绿了去合
- webhook 常驻轮询

## 入口

- 查询 / 文案:`packages/api/src/services/pr.ts` `listPrChecks` / `parsePrChecksJson`
- 每跳同步:`packages/api/src/router/turn/segment.ts` `syncPrChecks`
- 红了叫醒:`packages/api/src/router/turn/settle.ts`
- 指纹:`ThreadRepo.seenPrCheckIds`
- 记分板:`pr-ci-red` / `pr-ci-green`
