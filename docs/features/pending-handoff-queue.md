# 交棒排队，跑完接下一条

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:公开 F122 / F175 —— 忙就排队、空了再出；A2A 接力也进同一条队，agent 条目一条条出队，同一线程同一时刻只跑一跳。
- 靠拢:拿「第二棒不再丢掉、队头跑完自动接下一条」。不搬 InvocationQueue 原样，不做人插话排队、优先级、steer 插队；心脏仍是 `executeTurn` + `pending-runner`。

## 门（各一句）

- **功能**：多 `@` 两只都交棒时，第二棒排进队；当前棒跑完平台自动跑下一棒，人不用手接。
- **价值**：球不再因为「一条线程一个槽」掉在地上；人少打一句「接着做」。
- **愿景**：仍是邮差。平台只记顺序、同一时刻只送一封，不决定内容。
- **落点**：`Thread.pendingQueue` + `ThreadStore` 入队/出队；`executeTurn` 多 `@` 不再丢棒；`followPendingChain` 槽空了就把队头填回去。顶栏同一行跟一句「后面还有 N 棒」。

## 为什么

[one-hop-per-thread.md](one-hop-per-thread.md) 把并行改成顺序，但数据模型仍是一个 `pendingHop` 槽：先交的留下，后交的落 notice「得人来接」。顺序执行保护了同一棵树，却把第二棒扔给人。

对照他们的邮箱，缺的不是第二心脏，是槽旁边一条 FIFO。租约、收尸、跑完再清都还能用队头那一格。

不做成 X：第二棒继续丢，面试讲「接力」时演示多 `@` 会当场露馅；后面做人插话排队 / 猫寄信，也没有队可以往上叠。

## 怎么做

1. `Thread` 加 `pendingQueue?: PendingHop[]`。老线程没有队 = 空队。队头仍占用现在的 `pendingHop` 槽。
2. 存储端口加 `enqueuePendingHop` / `promoteQueuedHop` / `clearPendingQueue`。memory 与 redis 都实现；写 hop 队列时发 sync。
3. `executeTurn` 多 `@`：第一个交棒留槽；第二个入队，notice 改成「排在后面，当前棒跑完接着跑」，不再写「得人来接」。
4. `followPendingChain`：当前链停了且槽空，把队头填进槽再跑。开机扫 / `run` 看见「槽空但队非空」也要捡。
5. 整队一起停：星星罐子、越界、PR 合了、人发了不续跑的新消息 —— 清槽也清队。人开口续跑（`shouldResumePending`）保留队。
6. 顶栏：球权文案不变；`pendingQueue.length > 0` 时同一行后面跟很淡的「后面还有 N 棒」。不新开队列面板。

验收：`@墨墨` 与 `@团团` 都交棒 → 先跑墨墨交出去的，跑完自动跑团团交出去的；时间线没有「得人来接」；第一棒还在跑时顶栏带「后面还有 1 棒」。

## 不做（本篇）

- 人在猫跑着时再发的话进队（F039 那半）
- 优先级、steer 插队、跨线程、猫寄信却不交棒
- 队列面板 / 展开列表；顶栏一句提示够演示

## 入口

- 队字段:`packages/shared/src/types.ts` `Thread.pendingQueue`
- 入队文案:`packages/shared/src/a2a.ts` `formatQueuedHandoffNote`
- 存储:`packages/api/src/stores/ports.ts` / `memory.ts` / `redis.ts` 的 `enqueuePendingHop` / `promoteQueuedHop` / `clearPendingQueue`
- 多 @ 入队 + 出队续跑:`packages/api/src/router/execute-turn.ts`
- 开机扫空槽有队也捡:`packages/api/src/router/pending-runner.ts`
- 顶栏:`packages/web/lib/ball.ts` `describeBall(..., queuedCount)`
