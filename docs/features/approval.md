# 审批：另一只猫审，人批落地

- 状态:`已落地`
- 对照 clowder:公开有跨模型互审、合并协议、愿景守护。我们收「写手改文件 → 另一模型看 diff → 人批准才进基线」，不做 SOP 全流程看板。
- 相关:[execute-turn.md](execute-turn.md)、[a2a.md](a2a.md)

## 功能

有沙箱 diff 就建审批卡、拉审查官。人点批准或 `#approve` 后 `git commit` 落地；打回带理由。

## 价值

人不用自己当唯一 reviewer，但仍握合并权。面试能讲状态机，不是「再 @ 一次请看看」。

## 愿景

审查是猫推理，落地是人拍板。平台建卡、改状态、提交基线。

## 架构落点

`executeTurn` 末尾 `git diff` → ApprovalStore。审查走同一 `runTurn`。配对优先名册，不写死模型名。`markApplied` 只接受 `approved`。

## 为什么这样设计

根因：只靠写手自己说「我测过了」，跨模型的价值没了；只靠人看完整 diff，人又变回瓶颈。

| # | 决策 | 理由 |
|---|---|---|
| D1 | 有 diff 自动拉审查，即使忘了 `@闪闪` | 纪律在平台，不在模型记性 |
| D2 | 状态机 draft → reviewing → approved/rejected → applied | `markApplied` 必须先 `approve()`，自动批准不能跳步（踩坑 8） |
| D3 | 审查看 git diff，忽略 `node_modules` | 否则卡上全是依赖噪音，审查官会跑去仓库根 |
| D4 | 落地 = 线程沙箱里 commit | 沙箱是 cwd 真相源 |

## 怎么做

1. 线程创建时 `git init` + 基线（含 package.json）。
2. 一轮结束后 diff；有改动则建卡，选 ≠ 写手的审查官跑 review prompt。刚交棒、槽里已是下一棒时本轮不建卡，等续跑结束再审。
3. UI 卡片或 `#approve` / `#reject`。批准后 commit，状态 applied；顶栏「已落地，等人开口」。

验收：沙箱写出 `add.ts`，卡上无 `node_modules`；批准后顶栏已落地。

## 不做什么

- 不做 Mission Hub / 愿景守护全阶段
- 不自动 merge 到喵窝主仓库（只落线程沙箱）
- 不让审查官改写手文件当「落地」

## 面试能讲

- **30 秒**：写手改沙箱，平台出卡，另一模型审，人批才 commit。互审是内建管线，不是聊天里求人。
- **追问「和 CI 有何不同」**：CI 是规则；这里是另一家模型看同一份 diff。人仍是合并权。
- **踩坑**：claude 必须 `bypassPermissions` 才能在 headless 跑命令；否则自检卡在审批，审查也无证据。
- **若继续往 clowder 靠**：他们按风险选审查车道。我们先保持「有 diff 就审」，加严可以后挂在状态机上。

## 代码入口

- 状态机：`ApprovalStore`（`packages/api/src/stores/`）
- git：`packages/api/src/services/git.ts`
- 管线：`packages/api/src/router/turn/settle.ts` 收尾 diff；`review.ts` 建卡并拉审查
- UI：web 审批卡片
