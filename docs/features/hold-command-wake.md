# 行首「等跑」：平台托管命令再叫醒

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:公开 `hold_ball({ wakeWhen: { command } })` — 等本地 gate/test/build 时，服务端托管命令，完成后带结果唤醒；猫不把长命令塞进同一轮 CLI。
- 靠拢:本刀只认行首 `等跑` / `HOLDCMD` + 命令。平台在沙箱跑完，再唤同一只一次，把退出码和输出尾巴注入。不 MCP，不定时器，不队列。

## 门（各一句）

- **功能**：猫行首写 `等跑 npm test`，顶栏「球在等」，测试由平台跑；跑完同一只再开口，人不用捡球
- **价值**：难任务不再把 `npm test` 卡在 5 分钟 CLI 里，球不掉地上
- **愿景**：邮差代跑沙箱命令并回信，不替猫推理
- **落点**：`parseHoldCommand` + `executeTurn` 当持球停链 + HTTP 返回后在 `workdir` 跑命令 + `resumePendingTurn` 唤同一只

## 为什么

现有 `等 测试跑完` 只记账，谁也不跑。猫只好自己在 CLI 里 `npm test`，挂死就被 `300s` 杀掉，写成「球还在地上」。他们对齐的是：等命令，是持球；跑命令，是平台的事。

`等 原因` 保持原样。`等跑` 才带命令，避免「等 测试跑完」被当成 shell。

## 怎么做

1. 行首 `等跑` / `HOLDCMD` / `holdcmd`，后面跟命令 → 持球 + 记下命令。句中「等跑」不算。空命令不算。
2. 写出则不补问、不掉地上、当轮不建审批卡。系统句：`球在等:墨墨 — 跑 \`npm test\`。人开口即取消。`
3. HTTP 先返回本轮（和交棒跟跑同一拍）。同一进程在线程沙箱 `cwd` 跑这条命令，单独超时（默认 3 分钟，短于 CLI 5 分钟）。
4. 结束（退出 / 超时 / 被杀）后注入系统句（退出码 + stdout/stderr 尾巴），`resumePendingTurn` 唤**同一只**，不追加用户消息。人下一条照常进 `executeTurn`，取消持球并停还没跑完的命令。
5. 验收：有 diff 仍写 `等跑 npm test` → 只叫一次、有「球在等」、没有「球还在地上」、没有审批卡；命令结束后同一只再被 `runTurn`，prompt 里看得到测试输出。

## 不做（本篇）

- `hold_ball` MCP、`wakeAfterMs`、CI / 飞书回调
- InvocationQueue / 跨线程邮箱
- 改 `等 原因`、审查通过 / 需修改

## 面试能讲

- **30 秒**：他们等测试用托管命令唤醒。我们用行首锚，邮差在沙箱跑完再投递。
- **追问「和等 有何不同」**：`等` 只挂牌；`等跑` 挂牌并且真跑。球都还在猫手上。
- **为什么不抄 MCP**：命令已经写在行首，不必再开工具通道。简历讲的是球权和超时分层，不是工具清单。

## 入口

- `parseHoldCommand` / `formatHoldCommandWakePrompt`：`packages/shared/src/a2a.ts`
- 记下命令、跑完再叫醒：`packages/api/src/router/execute-turn.ts` `rememberHoldCommand` / `followPendingChain`
- 沙箱执行：`packages/api/src/router/hold-command.ts`
- 顶栏仍认「球在等」：`packages/web/lib/ball.ts`
