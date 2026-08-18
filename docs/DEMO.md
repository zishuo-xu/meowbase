# 演示与架构一页

给自己录 1–2 分钟、或给简历讲项目用。对照 clowder:他们闭环后放多猫演示;我们演的是**一场接力**,不演邮箱/SOP。

## 你点哪里,期望看见什么

1. 打开 http://localhost:3300,点 **+ 新会话**。
2. 只说目标,或另起一行点名。人和猫都只认**行首 `@`**。例如:

   ```
   在沙箱写 add.ts,导出 add(a,b),写完自检。
   @墨墨
   ```

   不写 `@` 则走线程主猫(默认墨墨)。句中提「闪闪」或「不要 `@闪闪`」都不会叫它。同题并行则 `@墨墨` 和 `@团团` 各占一行。

3. 期望:
   - 侧栏标题变成任务摘要(不是时间戳)
   - 墨墨改沙箱、回复里带本轮命令和结果
   - 行首 `@闪闪` → `🤝 接力:墨墨 → 闪闪`,顶栏球在闪闪;点「交接包」能看到目标和任务
   - 写完有改动却忘了行首 `@` → 墨墨会再开口一次补出口;仍没有才「球还在地上」
   - 闪闪由平台接着跑,不必再发「继续」;写出「通过」后顶栏立刻「球在人手里」,不必等卡片刷出来;「需修改」则顶栏「球在写手手上」
   - 有改动时审批卡在闪闪跑完后出;侧栏该会话标 **待确认**;点进去滚到审批卡
4. 你点批准。期望顶栏变成 **已落地,等人开口**。

升级拍板(可选):让墨墨在两个方案里选一个。它行首写 `@人` 后,顶栏应是「球在人手里:墨墨请求拍板」,`💡` 提示不会盖住这句话。

持球(可选):墨墨行首写 `等 测试跑完` 后,顶栏「球在等:墨墨」,没有「球还在地上」,当轮不出审批卡。你再说一句,持球结束。

记忆(可选):先 `#learn 用户偏好 TypeScript` → `#confirm ev_…`,再新开线程说「之前我们约定用 TypeScript」。猫应带着这条证据开口,不必手打 `#ev_`。

拉闸(可选):另起一行只写 `星星罐子`,顶栏变成「已拉闸,等人开口」,本轮不再叫猫。走偏时说 `脚手架` / `绕路了` / `喵约`,当轮注入对照技能,不是再开一条协议。

## 简历口播(约 40 秒)

1. 这是多 Agent 协作平台,不是 Chat UI。模型推理,CLI 干活,平台只做邮差。
2. 平台管路由、线程、身份、记忆、技能、审批、审计。人拍板,猫推理。
3. 心脏是一条 `executeTurn`:系统命令 → 多 @ 并行 → 同步 A2A → 沉淀 → diff 建卡拉审查。
4. 交接对象在名册 `handoffTo`,不写 `if (claude)`。
5. 人和猫都是行首 `@` 才点名/交棒,句中 `@` 不当球权;`@人` 升级给你;行首 `等` 持球。该交棒却没出口,平台再问同一只一次。审查通过后顶栏球回人;需修改则球在写手手上。
6. 存储只依赖端口,Redis 可换。适配器统一 `runTurn`。
7. 和 clowder 对齐的是语义:行首 mention、升级给人、交接包给人看。
8. 不搬他们的邮箱、SOP、MCP、队列。我们是一场接力,不是猫窝操作系统。
9. 沙箱是每条线程的 cwd 真相源;审批 diff 不含 `node_modules`。
10. 证据能被「之前约定」问出来;人也能一句话拉闸。

## 架构(简历可讲)

三层:**模型**推理 → **Agent CLI** 干活 → **平台**管路由、线程、身份、记忆、技能、审批、审计。平台不替猫想。

心脏是 `packages/api/src/router/execute-turn.ts`:系统命令 → 多 `@` 同题并行 → 每条链同步 A2A → `#learn` → `git diff` 建卡并拉审查。

交接对象在名册 `handoffTo` / `handoff`,不写进 TypeScript 分支。存储只依赖 `stores/ports.ts`。

和 clowder 对齐的是行首 `@`、`@owner` 语义、交接包给人看、人能拉闸、证据能被问出来。我们不搬 mailbox、SOP Guardian、MCP、`hold_ball`、向量记忆网。

猫怎么交互、传什么、各自记什么、公共记什么，见 [docs/A2A.md](A2A.md)。功能一篇一刀，见 [docs/features/](features/)。

## 用 curl 走同一圈

```bash
THREAD=$(curl -sS -X POST localhost:3200/api/threads \
  -H 'content-type: application/json' \
  -d '{"title":"演示-沙箱 add.ts"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -sS -X POST "localhost:3200/api/threads/$THREAD/messages" \
  -H 'content-type: application/json' \
  -d '{"content":"在沙箱写 add.ts,导出 add(a,b),写完自检。\n@墨墨"}'
# 等返回后看消息里的 ap_xxxxxxxx,再:
# curl -sS -X POST "localhost:3200/api/threads/$THREAD/messages" \
#   -H 'content-type: application/json' \
#   -d '{"content":"#approve ap_xxxxxxxx"}'
```

一次完整流程大约 $0.2–0.4(视模型和是否自检而定)。
