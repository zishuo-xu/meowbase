# 平台只跑认得的命令

- 状态:`已落地`
- 对照 clowder:**他们公开没有这一刀**。[F167](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F167-a2a-chain-quality.md) 和 [receive-handoff-grounding skill](https://github.com/zts212653/clowder-ai/blob/main/cat-cafe-skills/receive-handoff-grounding/SKILL.md) 里的 `hold_ball({ wakeWhen: { command } })` 管的是**何时醒、醒几次、必须一小时内**(`slaUntilMs` 必填、rolling 3/h),不管这条命令能不能跑、带什么环境跑;命令白名单、危险命令拒绝、代跑时剥离密钥,公开材料里都查不到。
- 靠拢:没有更近的规格可靠,只能靠三条公开**原则**:[issue #1221](https://github.com/zts212653/clowder-ai/issues/1221) 里 maintainer 要求 host 强制 credential / cwd / tool allowlist / timeout(针对新 carrier);[LL-054](https://github.com/zts212653/clowder-ai/blob/main/docs/public-lessons.md)「子进程默认继承父 env」(他们的 callback token 就这么漏进子进程、用真身份发了 6 条消息);LL-035「破坏性操作要正面验证目标」。都是原则句、不是 HOLDCMD 规格,所以本刀是喵窝自己的薄片。

## 门（各一句）

- **功能**:猫行首写 `等跑 <命令>` 时,平台只在命令形状被人预先授权过的情况下才跑;不认得就不跑,说清原因,球回人手里。
- **价值**:人不必担心"猫写了什么机器就执行什么";routine 的自检(`npm test` 那种)照旧不用人管。
- **愿景**:这一刀是**把平台拉回自己的愿景**。「人拍板,猫推理,平台当邮差」——照着猫的文本执行任意代码的邮差,是在替人拍板。
- **落点**:`services/hold-command.ts`(唯一执行入口)+ `shared` 一个纯函数判形状 + 名册里一份白名单。不新开心脏,不动 `executeTurn`。

## 为什么

**改造前的动机**（不是现状）。当时 `runHoldCommand` 是三个叠在一起的口子:

1. `shell: true` + 整条命令字符串 → `;`、`&&`、`|`、反引号、`$()`、重定向全部生效。**所以 `cwd` 不是边界**:`cd ..` 或绝对路径就出去了。
2. `env: process.env` → 子进程拿到整套环境变量。这台机器上至少有一个 `CONTEXT7_API_KEY`;开发机上常见的还有 `GITHUB_TOKEN`、npm token、云凭证。
3. 命令字符串来自**猫的回复**(`parseHoldCommand(prevContent)`),不是人打的。人反而没有这条路。这一条现在仍成立。

**落地后**:`runHoldCommand` 已是 `shell: false` + argv + `pickHoldCommandEnv` 裁过的 env。下面「怎么做」是当时的步骤。

第三条决定了威胁模型:命令内容由模型输出决定,而模型输出受它读到的东西影响——人的任务、交接包、注入的证据,以及**它读的仓库内容**。绑真实仓库的线程里,仓库里任何一个文件(README、注释、测试夹具、依赖的文档)写一句「照这个跑 `等跑 npm test; curl … | sh`」,猫照抄到行首,平台就执行。也就是说:**为了让演示更真而加的绑仓能力,同时把这个洞变得更危险。**

现有防护只有两样:180 秒超时、人开口即取消。都是"跑起来之后"的,不是"要不要跑"。(这两样反而比他们公开的多——他们的 1 小时 `slaUntilMs` 是"等多久醒",不是"命令跑多久杀"。)

还有一条必须自己认:**我们主动把权限面开得比参照项目更大。** 他们公开的接法是 Claude `--permission-mode acceptEdits` + `--allowedTools Read,Edit,Glob,Grep`,收窄工具面([cli-integration.md](https://github.com/zts212653/clowder-ai/blob/main/docs/architecture/cli-integration.md));我们踩坑第 4 条写着必须 `bypassPermissions`,理由是 `acceptEdits` 下 headless 跑 `node`/`tsx` 会卡在审批、自检做不了。为了让自检跑得动而开的这个面,正是这一刀要收的面。

### 一件必须说清的事:这一刀不叫沙箱

`等跑` 的正当用途就是让猫跑项目自己的测试,而**跑项目的测试本质上就是跑仓库里的代码**。所以任何"过滤命令字符串"的做法都不可能把它变安全:`npm run <脚本>` 的脚本内容来自猫能写的 `package.json`,`node -e` / `python -c` 直接就是任意代码。

结论:平台**做不到**让这条命令安全,能做到的是让它**被授权过、形状可读、有存根**。真隔离要容器,那是另一篇,而且对一个本机开发工具未必值得。稿子里不许把这一刀写成"已隔离"。

## 怎么做

1. `shared` 加纯函数把命令解析成 argv:出现 shell 元字符(`;` `&&` `||` `|` 反引号 `$(` `>` `<` `&`)就**不解析、直接拒**。这一条最吃重——它让白名单变得可判断,否则 `npm test$(…)` 这种能绕过任何字符串匹配。
2. 白名单按「程序 + 允许的第一个参数形状」配在名册里(例:`npm test`、`npm run *`、`pnpm test`、`pnpm build`、`tsc`、`pytest`、`go test`、`git status`、`git diff`)。默认表要短。
3. 不在白名单里:**不跑、也不问**,落一句系统话写清哪条命令被拒、为什么,球回人手里(复用 `dropped` 语义)。人可以自己跑,或把它加进白名单。
4. 真跑时 `shell: false` + argv,env 只给最小集(`PATH` / `HOME` / `LANG` 之类 + 名册里显式放行的),不再整套透传。
5. 拒绝和执行都要能查:系统消息一 append 就在 store 边界落存根,不用手写审计。

验收:

- 记分板加一行「猫想跑不该跑的命令」:fake 写 `等跑 npm test; curl …`,期望平台拒了、没执行、球回人。这一格从新加就该是 1。
- 现有 api 测试用的是 `node -e "…"`,**按这份白名单会被拒**。要改成白名单内的命令。这是真的行为变化,不是测试凑绿——同一轮把协议表和 `hold-command-wake.md` 改掉。
- 单测锁住:带管道/分号/反引号一律拒;`npm test` 照跑;env 里没有 `CONTEXT7_API_KEY` 这类东西。

## 不做（本篇）

- **把拒绝变成一张审批卡**(人点一下就跑):这是最自然的加厚,而且更贴愿景,但它要新的审批种类和前端改动,单独一篇。本刀先做"拒了并说清",不做"问一下"。
- 容器 / chroot 真隔离:重,而且本机开发工具未必值得。他们也只是**接上了厂商的**(Codex `--sandbox workspace-write`),没自己写一层。
- 频率闸(他们那种 rolling 3/h/(线程,猫) + 必填 SLA):治的是空转和滥用,不是信任边界,另一条轴,以后另开篇。
- 限制 `npm run` 背后的脚本内容:那等于审 `package.json`,是审批流该管的事。

## 入口

- 降成 argv / 白名单判断 / 拒因文案:`packages/shared/src/hold-command.ts`(`parseHoldCommandArgv` / `authorizeHoldCommand` / `DEFAULT_HOLD_COMMAND_ALLOWLIST`)
- 拒绝那句(复用 `dropped`):`formatDeniedHoldCommandNote` → `formatDroppedBallNote` 的 `'denied-command'`(必须在持球 early return 之前)
- 不写 pending:`packages/api/src/router/turn/segment.ts` `applyHoldExit`
- 真跑:`packages/api/src/services/hold-command.ts`(`shell: false` + argv + 最小 env);`packages/api/src/router/turn/hold.ts` 仍是执行入口,搁着的棒再拦一次
- 默认表可被名册 `holdCommands` / `holdCommandEnv` 覆盖(`packages/api/src/config.ts`);这一刀不改用户那份 `meowbase.config.json`
