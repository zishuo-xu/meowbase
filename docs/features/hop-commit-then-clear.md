# 跑完落库再清那一棒

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:公开 InvocationQueue 的语义是「一次调用是一个工作单元，有主人、能重投」——重投的前提就是干完之前别把单子撕了。
- 靠拢:学「工作单元有身份、干完才算交付」。仍不搬他们的队列结构，仍是线程上一个 `pendingHop` 槽，只是这个槽多一个 `id`。

## 门（各一句）

- **功能**：猫正在想的时候 API 被杀，重启后这一跳自己重跑，不是永远搁着
- **价值**：人不用发现「这只猫再也不说话了」再手打一句捡球
- **愿景**：邮差把信送到才划掉，不是拿到手就划掉
- **落点**：`resumePendingTurn` 的消费次序 + `PendingHop.id` 当幂等键；租约和收尸沿用 [durable-relay.md](durable-relay.md)，不新开第二心脏

## 为什么

上一刀真机验出来的洞：`resumePendingTurn` 是「读到 hop → 先清空 → 再跑模型」，所以猫真正在想的那 10–50 秒里 Redis 已经没有 `pendingHop`。而这恰恰是最可能死进程的一段（热更新、按端口杀、崩溃）。开机扫描只会打 `resume sweep n=0`，球从此躺在地上等人。

租约、开机扫、收尸都已经建好了，缺的只是「别提前把单子撕了」。

## 怎么做

1. **`PendingHop` 加 `id`**（写入时生成）。四个写入点都带上：`segment.ts` 的接力和 `等跑`、`hold.ts` 的跑完改写、`pending-runner.ts` 的重启改写。
2. **跑完落库再清，而且只清自己那一棒**。`resumePendingTurn` 不再一开始就 `setPendingHop(null)`；跑完、消息和 `settleTurn` 都落库之后，用 `clearPendingHopIfSame(threadId, hopId)` 清。必须比 id：猫这一跳又交棒时 `runSegment` 已经把**下一棒**写进同一个槽，无条件清会把新棒抹掉。
3. **消息记下它属于哪一棒**。`Message` 加 `hopId?`，这一跳的助手消息带上。这是幂等键。
4. **重跑时先看这一棒是不是已经产出过**。同 `hopId` 已有 `completed` 的助手消息 → 不再调模型，直接往下走收尾和清棒（进程死在「落库」和「清棒」之间的那一瞬不会产出两条回复）。同 `hopId` 有 `streaming` 的半截消息 → 判定为被打断，标成 `failed` 并写明「平台重启，这一跳没写完」，然后重跑。顺带治好被 `kill -9` 打断后那条永远停在「思考中」的气泡。
5. **验收**（这次窗口是人类尺度，真机可验）：发一句会交棒的话，等日志出现 `hop start` 且那只猫正在想的时候 `lsof -ti :3200 | xargs kill -9`；重启后不发任何消息，日志应出现 `resume sweep n=1` → `resume claim` → 同一只猫的 `hop start`，最后聊天里那一跳有结果、半截气泡是 `failed` 而不是永远思考中。

## 实测（真机一次）

杀在闪闪那一跳上：`pendingHop` / `pendingHopId` 都还在 Redis，半截气泡原地 `patch` 成 `failed`（同一个消息 id，不是删了重建），重启后不发任何消息，`resume sweep n=1 → resume claim → hop start` 是连着的日志行，API 起来到重跑约 1.2 秒；闪闪只有一条 `completed` 回复，一张卡 `verdict=pass`，`hoplease:` 没残留。约 $0.28。

一条限制同时暴露出来：租约 TTL 60 秒、抢租约是 `SET NX`，所以重启发生在 60 秒内时开机第一扫抢不到（死者的租约还没过期），最坏近 90 秒才动。这次验证的重启隔了 2.5 分钟，正好躲开了它。**已在 [durable-relay.md](durable-relay.md) 第 5、6 条补上**：开机首扫强抢，且只在绑上端口之后才敢强抢。

## 落地时多改的一处

「跑完再清」逼出一个原来没想到的连带：`settleTurn` 判断要不要跑审查，靠的是「槽里有没有 pendingHop」。现在跑完那一刻槽里还躺着**刚跑完的这一棒**，老条件会把每一次续跑都当成「还在等下一棒」而跳过审查。所以判断要改成比 id——槽里是**下一棒**才算在等，还是自己那一棒就照常审。

## 不做（本篇）

- 重投次数上限、退避、死信：这一刀是「至少跑到」，跑不动仍是现在的「球还在地上」
- 多实例抢棒（租约仍按单实例）
- 沙箱文件层面的幂等：猫重跑时自己看得见上次写了什么，平台不做回滚

## 入口

- 消费次序、重跑认消息、`finally` 里比 id 清棒：`packages/api/src/router/execute-turn.ts` `resumePendingTurn`
- 审查跳过条件比 id：`packages/api/src/router/turn/settle.ts`
- `clearPendingHopIfSame`：`packages/api/src/stores/ports.ts`；Redis 另存一个 `pendingHopId` 字段 + Lua 比较后 `hdel`（不在 Lua 里解 JSON），旧记录读到时补 id 并写回，见 `stores/redis.ts`
- `PendingHop.id` / `Message.hopId`：`packages/shared/src/types.ts`；四个写入点在 `turn/segment.ts`、`turn/hold.ts`、`pending-runner.ts`
- 半截消息的话术：`formatHopInterruptedNote`（`packages/shared/src/a2a.ts`）
- 单测：`packages/api/test/pending-runner.test.ts`
