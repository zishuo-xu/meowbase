# 交棒后本轮可先结束

异步 A2A 这条线他们很重。本篇是最薄的一刀：只延后下一跳。邮箱、MCP、hold_ball 以后加厚，不写进这一刀。

- 状态:`已落地`
- 对照 clowder:公开 A2A 是异步消息。本篇只拿「人能离开」，不拿邮箱和 `hold_ball`。

## 门（各一句）

- **功能**：墨墨行首 `@闪闪` 后，人立刻看到球在闪闪；闪闪稍后才跑
- **价值**：人不用盯着一条消息跑完整串
- **愿景**：仍是邮差，球权可见
- **落点**：`executeTurn` 写/读一条 pending hop。不新开路由器

## 为什么

同步接力把「下一只要跑两分钟」绑在「这一条还没结束」上。人一走或想开第二条线程就被堵住。交接包格式不变，只是延后调用。

## 怎么做

1. 当前跳解析到行首 `@下一只` → 把已有交接包存成 pending，本轮返回。
2. 顶栏持球者 = pending 的目标（`@人` 仍立即停，不进 pending）。
3. 人再发消息或点继续 → 仍进 `executeTurn`，取出 pending 当这一跳。
4. 验收：交棒后本轮不再调用下一只 `runTurn`；再触发时闪闪吃的还是那份包。

先写这条失败测试，再改存储端口 + `executeTurn` 收尾/开头。

## 不做（本篇）

- 跨线程邮箱、猫私聊
- MCP `targetCats`、`hold_ball`
- 自动审查怎么改排队（有 diff 仍按现审批，另开篇再拆）

## 入口

- 判断续跑：`packages/shared/src/a2a.ts` `shouldResumePending`
- pending：`ThreadStore.setPendingHop`
- 管线：`packages/api/src/router/execute-turn.ts`
