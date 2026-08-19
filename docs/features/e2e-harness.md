# 整机自检

一条完整接力链和一次「进程被杀」的续跑,由 CI 每次 push 自己跑一遍,不花钱。

- 状态:`设计中`
- 对照 clowder:他们公开把「验证过才算完成」写进 [SOP](https://github.com/zts212653/clowder-ai/blob/main/docs/SOP.md),最近公开在吵的是 eval 测量可信度([issue #1213](https://github.com/zts212653/clowder-ai/issues/1213))——「机器自己证明」在他们那儿是协作纪律的一部分,不是测试细节。
- 靠拢:靠「验证不靠人复述,靠机器每次复验」这一条。本刀没更近的地方是不做 eval 打分(通过率/跳数的 before-after 另开一篇),只做「全链在 CI 里能跑通」。

## 门(各一句)

- **功能**:push 一次,CI 就把「写手改文件 → 行首交棒 → 审查官下结论 → 审批卡」跑完,并且杀一次进程验证那一棒被捡回来。
- **价值**:人不用每次开浏览器手动验;断言从「我们那次验过」变成「每次 push 都验」。
- **愿景**:仍是邮差。不改协议、不给猫加能力,只把平台自己的行为架到可复验的位置。
- **落点**:`scripts/`(fake CLI + e2e 入口)、`.github/workflows/ci.yml`、新增 `tsconfig.scripts.json`。不进 `executeTurn`,不改 store 契约。

## 为什么

不做成 X,已经在付代价了:`scripts/smoke.ts` 悄悄烂了。它还在用旧的分散 store 工厂拼 `stores`,没有 `audit` 这一项,而 `buildServer` 现在要求 `AppStores` 并会把 `deps.stores.audit` 交给 `auditMessages`。因为 `safeAppendAudit` 有 try/catch,它不崩,只是每写一条消息吐一次 `audit fail`——静默降级。它也没在 `listen` 之后调 `startPendingRunner()`,所以现在跑冒烟根本验不到交棒续跑。

根因不是一次疏忽,是缺了一道门:CI 只 `pnpm -r build` 三个包,`scripts/` 不在任何 tsconfig 里,`pnpm smoke` 走 tsx 也不做类型检查。这处类型错误没有任何环节会拦。

同时,「重启不丢球」是这个项目最硬的一条断言,现在只有一次人工 `kill -9` 的记忆做证。人工验过的东西,过三个月改了别处就不知道还成不成立。

和他们对齐的是「验证过才算完成」;做成喵窝自己的一片:不要求猫写验证报告(那是[验证闸](verification-gate.md)那一刀),而是要求**平台自己**在 CI 里把全链跑通。

## 怎么做

1. 修 `scripts/smoke.ts`:改用 `createRedisStores`(含 audit),`listen` 成功之后调 `startPendingRunner()`。它继续是「真实 CLI、花钱、手动」那条路,不进 CI。
2. 加 `tsconfig.scripts.json`(extends `tsconfig.base.json`,include `scripts/` 与它引用的包源码),CI 加一步 `tsc --noEmit -p tsconfig.scripts.json`。
3. 补 fake CLI:现有 `fake-claude-writer.mjs` 补一行行首 `@` 交棒;新增 fake 审查官,输出命令+结果和单独一行「通过」;两者支持用环境变量控制延时(给第 5 步留口)。
4. 新增 `scripts/e2e.ts`:把 API 当子进程起(fake bin 走环境变量),建线程 → 发一条消息 → 轮询到链跑完 → 断言 relay 系统消息在、审批卡建了一张、审计动作顺序对、账本能加出 token。
5. 崩溃一段:让 fake 审查官睡到一半时 `kill -9` 子进程,再起一个,断言那一棒被捡回来跑完、半截助手气泡标 `failed`、最终审批卡仍然只有一张(不重复建)。
6. CI 加一步跑 `pnpm e2e`,用 fake bin,不花钱。

验收:本地 `pnpm e2e` 全绿;CI 同样绿。反向验两条——把 `smoke.ts` 的 `audit` 去掉,第 2 步必须红;把 `startPendingRunner()` 注掉,第 5 步必须红。

## 不做(本篇)

- 不做 eval 打分(通过率/跳数/掉球/花费的 before-after)。下一篇。
- 不做多 provider 矩阵(gemini / opencode 的 fake)。先只走 claude 协议这一条链。
- 不动 `executeTurn` 和任何协议语义;fake CLI 只待在 `scripts/fixtures/`。

## 入口

落地后填路径。
