# 花超了就拒跑

一篇只写**一个**可验收的特性。写完就做这一刀,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一刀能靠多近。能靠就靠;本刀没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F051 额度池看板与预算闸——账本不只展示,超了拒跑。
- 靠拢:拿「花超了不许再叫猫」。上限配在配置 / 环境变量,闸装在 `executeTurn` 叫猫之前。系统命令(批准、拉闸、确认证据)仍立刻走。不按猫拆池、不做实时推送。

## 门（各一句）

- **功能**：全平台已报真实花费达到上限时,再发普通任务落一条系统句、不调猫。
- **价值**：演示和自用不会在人走开后把钱烧穿。
- **愿景**：邮差可以拒收超重的包裹。人拍板的系统命令仍能送。
- **落点**：`budgetUsd` 进 Config;`isOverBudget` 纯函数;`executeTurn` 在系统命令之后、路由之前查账。新 `systemKind: budget`。

## 为什么

账本已经能看 `Message.usage.costUsd`,但花超了不会停。对照他们:看板和闸是一块。喵窝差的就是准入。gemini 不报成本——闸只看报上来的真实花费,不估,和账本同一口径。没配上限 = 不拦。

## 怎么做

1. `budgetUsd?: number`。环境变量 `MEOW_BUDGET_USD` 覆盖配置文件。缺省或 ≤0 不拦。
2. `isOverBudget(spent, cap)`:双方都是有限正数且 spent ≥ cap。
3. `executeTurn`:系统命令先走;然后若配了上限,扫全部线程已完成助手消息的 `costUsd` 合计,超了落 `budget` 消息,registry 零调用。
4. Hub 账本那一格显示上限和已花;超了标红。
5. 记分板一行「花超了还叫猫」期望 1。

验收:先塞一条 costUsd=1 的完成助手消息,`budgetUsd=1` 再发任务 → 不调猫、时间线有「预算用完」;批准卡片仍能走。

## 不做（本篇）

- 按猫 / 按线程拆池(见 [budget-pools.md](budget-pools.md))
- 按价格表估算 gemini
- 热改上限的 Hub 表单(见 [budget-pools.md](budget-pools.md))

## 入口

- 纯函数:`packages/shared/src/token-usage.ts` `isOverBudget` / `formatBudgetGateNote`
- 闸:`packages/api/src/router/execute-turn.ts` 系统命令之后、路由之前
- 配置:`MEOW_BUDGET_USD` / `budgetUsd`
- Hub 账本显示上限:`packages/web/components/TeamHub.tsx`
- 记分板:`budget-gate`
