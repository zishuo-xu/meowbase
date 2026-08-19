# 接力不怕重启

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:公开有 InvocationQueue——每次调用进队列、有主人、失败能重投，不靠某个请求的生命周期。
- 靠拢:只学「一跳要有主人，主人死了要有人接」。不搬他们的队列结构、不新开 worker 进程；状态仍是线程上那一个 `pendingHop` 槽。

## 门（各一句）

- **功能**：API 重启、崩溃、或续跑自己抛异常之后，搁着的那一棒平台自己捡起来接着跑
- **价值**：人不用发现「怎么半天没动」再手打一句「继续」把球捡回来
- **愿景**：邮差记得手上还有没送完的信，重启也记得
- **落点**：`pendingHop` 加租约 + 开机扫一遍 + 一个定时收尸；续跑仍走 `followPendingChain` / `resumePendingTurn`，不新开第二心脏

## 为什么

今天交棒之后的续跑是 `packages/api/src/http/server.ts` 里 POST 返回后 `void followPendingChain(...)` 出去的进程内异步，而且没有 `.catch()`。三种情况下那一棒就永远躺在 Redis 里：

1. API 重启（改代码热更新、`lsof -ti :3200 | xargs kill -9`）——`index.ts` 开机什么都不扫。
2. 进程崩了。
3. 续跑链里任何一处抛异常——未捕获，循环直接断，`pendingHop` 还在。

「等跑」更脆：子进程、超时定时器、`running` Map 全在进程内，Redis 里只留着 `pendingHop.holdCommand`。重启后既不重跑也不叫醒，那只猫等到世界末日。

还有一个今天就存在的隐患：`resumePendingTurn` 是「读到 hop → 跑 → 清空」，中间没有原子占用。两个跑者（比如人手打「继续」正好撞上背景续跑）会同时把同一棒跑两遍，两次真实模型调用、两份 diff。

「重启能续跑」是简历上 durable orchestration 那句话的全部依据，也是三块地基里剩下的最后一块。

## 怎么做

1. **一跳一个主人**。`ThreadStore` 加三个方法：`claimPendingHop(threadId, runnerId, ttlMs)`（Redis `SET NX PX` 到 `hoplease:<threadId>`，抢到才算主人）、`renewPendingHopLease`、`releasePendingHopLease`。占用是原子的，顺手把上面那个双跑隐患一起堵掉。
2. **跑之前先抢，跑完就放**。`buildServer` 里把每个 POST 现在拼 `TurnContext` 的那段抽成一个工厂，续跑统一走 `runPendingChain(threadId)`：抢租约 → 跑 `followPendingChain` → `finally` 释放。这次带 `.catch()`，异常写进日志而不是变成未捕获拒绝。租约在跑的时候按心跳续期，所以一跳跑多久都不会被人抢走；进程死了则最多一个 TTL 之后自动过期。
3. **开机扫一遍**。`ThreadStore.list()` 过滤出还带 `pendingHop` 的线程（`thread:index` 已经够，不需要 SCAN），逐个捡。抢不到租约的就是别人在跑，跳过。两条自我约束：**一次只捡一棒**（串行，开机时几条线程都搁着棒不要同时叫醒好几只猫），**搁超过 30 分钟的不捡**（按线程最后一条消息算，只记一行 `resume skip`）——人早走了，不能背着人烧钱。
4. **定时收尸**。一个 30 秒的 `setInterval`（`.unref()`）重跑同一个扫描：租约过期的孤棒会在这里被接管。这是仓库里第一个 interval，所以同一刀补上 Fastify `onClose` 清掉它，否则测试里 `app.close()` 会挂住。
5. **开机那一次可以强抢租约，之后的收尸不行**。租约 60 秒，而你改代码重启只要十几秒——死者的租约还没过期，开机扫会看到棒却抢不到，最坏近 90 秒才动。单实例下刚启动的进程知道任何挂着的租约都没有活主人（唯一可能持有的那个刚死），所以首扫用强抢（日志 `resume steal`）。定时收尸必须继续尊重租约，因为活着的 POST 路径正握着自己那条链的。
6. **强抢只能发生在绑上端口之后**。实测 Fastify 的 `onReady` 在 `listen` 撞 EADDRINUSE 之后**仍然会跑完**，所以开机扫不能挂 `onReady`：那会让一个起不来的新进程去强抢旧进程正在跑的那一跳，跑两遍、花两次钱。改成 `listen` 成功后由 `index.ts` 显式叫 `startPendingRunner()`——**绑上 3200 才是「我是唯一实例」的凭证**。
7. **重启后的「等跑」不偷跑命令**。带 `holdCommand` 的 hop 被**开机/收尸**捡到时不重新执行那条命令——重跑一条任意 shell 命令太危险。改成写一句系统话「平台重启，命令没跑完」并清掉 `holdCommand`，让同一只猫被叫醒后自己决定要不要再跑。人当场发的那句「等跑」不受影响，照旧由平台真跑。
8. **验收**：直接往 store 里塞一个 `pendingHop` 再起 API（等于重启现场）→ 不用发任何消息，那一棒自己跑完、审批卡自己出来（`sync` 事件已经会把它推到前端）。并发跑两个 `runPendingChain` → 只有一个真的调模型。绑不上端口的那个进程不碰球。

## 这一刀盖不到哪（实测）

真机验过一次：交棒之后 `resumePendingTurn` 是「读到 hop → 先清空 → 再跑模型」，所以**猫正在想的那 10–50 秒里 Redis 已经没有 `pendingHop`**。进程死在这段（最可能死的一段）开机扫不到东西，日志只会是 `resume sweep n=0`。

本刀真正接得住的是：`等跑` 的棒（命令跑最多 180 秒，这期间 hop 一直躺在 Redis 里，人类尺度的窗口）、链深用尽没人接的棒、交棒到抢租约之间那一毫秒，以及续跑自己抛异常（`.catch()` + 释放租约后由收尸接管）。

要盖住「猫正在想的时候进程死了」，得把消费从「跑之前清」改成「跑完落库再清」，让租约代表在跑中——那是 at-least-once，还要决定半截的助手消息怎么收拾。**下一篇 [hop-commit-then-clear.md](hop-commit-then-clear.md) 已经补上这条**，本篇的实测结论保留在这里，说明这一刀当时到哪。

## 不做（本篇）

- 多实例／多机抢棒：租约按单实例设计，多开一个 API 的语义以后另开篇。开机强抢正是靠这条前提——真要多实例，得先换成「主人还活着吗」的判据（实例心跳之类），不能再靠「绑上端口」
- 失败重投、退避、死信：这一刀只保证「有人接着跑」，跑失败仍是现在的「球还在地上」
- 真队列结构（list / stream / 优先级）：仍是线程上一个槽，一次一棒
- 重启后自动重跑「等跑」的命令

## 入口

- 抢租约、续期、收尸、开机扫：`packages/api/src/router/pending-runner.ts`
- 租约三方法：`packages/api/src/stores/ports.ts`；Redis `hoplease:<threadId>`（`SET NX PX` + Lua 比较后 `pexpire` / `del`）在 `stores/redis.ts`
- 接线（`createTurnContext`、`startPendingRunner`、`onClose` 停表）：`packages/api/src/http/server.ts`；`listen` 成功后才叫 `startPendingRunner()` 在 `packages/api/src/index.ts`
- 重启后叫醒的话术：`formatHoldCommandRestartNote` / `formatHoldCommandRestartWakePrompt`（`packages/shared/src/a2a.ts`）
- 单测：`packages/api/test/pending-runner.test.ts`
