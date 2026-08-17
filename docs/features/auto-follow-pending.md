# 交棒后平台自己续跑

对照他们：行首 `@` 后平台投递并唤起下一只，人不当路由器。本篇只补「不用人点继续」。

- 状态:`已落地`
- 对照 clowder:公开 A2A 是平台自己 dispatch，不是人点下一棒。

## 门（各一句）

- **功能**：墨墨交完，闪闪自己被唤起，人不用再发一句
- **价值**：日常互审少一次人介入
- **愿景**：仍是邮差，自己投递；`@人` 立刻停
- **落点**：`resumePendingTurn` + HTTP 首轮返回后跟跑。不新开队列进程

## 为什么

上一刀用人开口当开关，人介入比他们多一拍。要对齐「人少当路由器」，续跑必须是平台的事。

## 怎么做

1. `resumePendingTurn`：不追加用户消息，取出 pending 跑那一跳。
2. 若又交棒，继续跟，直到没 pending、`@人`、或链深用尽。
3. HTTP：先把本轮第一只的回复返回，再在同一进程里跟跑；WS 照常推。取消仍能停后面的跳。
4. 验收：一条 `@墨墨`（回复里行首 `@闪闪`），不发「继续」，闪闪的 `runTurn` 被调用。

## 不做（本篇）

- InvocationQueue / 跨线程邮箱
- hold_ball、空闲很久再唤醒

## 入口

- `resumePendingTurn` / `followPendingChain`：`packages/api/src/router/execute-turn.ts`
- HTTP 首轮返回后跟跑：`packages/api/src/http/server.ts`
