# 人插话先排队，不打断正在跑的猫

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:公开 F039 / F122 —— 槽被占时人发的消息入队，steer 才能立刻执行；A2A 接力不因人插话 abort。
- 靠拢:拿「忙就排队、空了再出、拉闸仍立刻生效」。不搬优先级、steer 插队、跨来源统一出队。心脏仍是 `executeTurn` + `pending-runner`。

## 门（各一句）

- **功能**：猫还在跑或接力还没跟完时，人再发的普通话先入队，当前棒不被清掉、不被 abort。
- **价值**：人能边看边补一句，不必等气泡结束；正在跑的那只猫不会被新话搅乱。
- **愿景**：仍是邮差。平台只决定「现在送还是先搁着」，不改信的内容。
- **落点**：`Thread.inboundQueue`；`POST /messages` 见忙则入队；链跑完再 `executeTurn`。星星罐子 / `#approve` / `#reject` / `#confirm` 仍立刻走，不进队。

## 为什么

上一刀把猫交的第二棒排进 `pendingQueue`。人话还是直打 `executeTurn`：前端 `sending` 一结束就能再发，后端见 `pendingHop` 且不是续跑就把槽和队清掉。演示时「猫还在审、人补一句」会把审查棒扔掉。

对照他们：占槽时人话必须排队，不能 abort 正在跑的 A2A。喵窝已有 `runningTurns` 和 hop 租约，缺的是人话自己的 FIFO。

不做成 X：面试演示插话会打断审查，邮箱叙事当场破。

## 怎么做

1. `Thread` 加 `inboundQueue?: { id, content }[]`。老线程没有 = 空。
2. 存储端口加 `enqueueInbound` / `shiftInbound` / `clearInboundQueue`。memory 与 redis 都实现；写队列发 sync。
3. `POST /messages`：线程有 `runningTurns` 或 `pendingHop` / `pendingQueue` 时，普通正文入队、立刻回 202 和一条 `notice`「已排队，当前棒跑完再送」。不调 `executeTurn`。
4. `followPendingChain` / `runner.run` 收尾：槽空、交棒队空、没有 running 时，取出队头再 `executeTurn`。
5. 例外立刻走、顺手清人话队：星星罐子、`#approve` / `#reject` / `#confirm`。中止按钮只 abort 当前棒，不清人话队（人已经说了要补的那句还在）。
6. 顶栏：人话队非空时同一行跟「还有 N 句在等」。输入框忙碌时仍可发送（不再 `disabled`），按钮文案「排队」。

验收：挂住的猫还在跑时再 POST 一句 → 那只猫没被 abort、槽还在、新话在 `inboundQueue`；跑完后那句才变成用户消息并路由。星星罐子仍立刻拉闸。

## 不做（本篇）

- 优先级、steer 插队、跨线程
- 完整 QueuePanel 拖拽（可见列表面板见 [queue-panel.md](queue-panel.md)）
- 猫寄信却不交棒

## 入口

- 队字段:`packages/shared/src/types.ts` `InboundMessage` / `Thread.inboundQueue`
- 入队文案:`packages/shared/src/a2a.ts` `formatInboundQueuedNote`
- 存储:`enqueueInbound` / `shiftInbound` / `clearInboundQueue`
- 忙时入队 + 跑完再送:`packages/api/src/http/server.ts` `POST /messages` / `drainInbound`
- 顶栏 / 输入:`packages/web/lib/ball.ts`、`ChatInput` 忙碌时按钮写「排队」
