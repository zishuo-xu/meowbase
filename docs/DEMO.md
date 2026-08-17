# 演示与架构一页

给自己录 1–2 分钟、或给简历讲项目用。对照 clowder:他们闭环后放多猫演示;我们演的是**一场接力**,不演邮箱/SOP。

## 你点哪里,期望看见什么

1. 打开 http://localhost:3300,点 **+ 新会话**。
2. 只说目标,不要在句子里写 `@闪闪`(会被当成同题并行)。例如:

   > 在沙箱写 add.ts,导出 add(a,b),写完自检。

3. 期望:
   - 侧栏标题变成任务摘要(不是时间戳)
   - 墨墨改沙箱、回复里带本轮命令和结果
   - 行首 `@闪闪` → `🤝 接力:墨墨 → 闪闪`,点「交接包」能看到目标和任务
   - 顶栏时间线 `墨墨 → 闪闪`
   - 闪闪复跑后写「通过」或「需修改」
   - 侧栏该会话标 **待确认**;点进去滚到审批卡
4. 你点批准。期望顶栏变成 **已落地,等人开口**。

升级拍板(可选):让墨墨在两个方案里选一个。它行首写 `@人` 后,顶栏应是「球在人手里:墨墨请求拍板」,`💡` 提示不会盖住这句话。

## 架构(简历可讲)

三层:**模型**推理 → **Agent CLI** 干活 → **平台**管路由、线程、身份、记忆、技能、审批、审计。平台不替猫想。

心脏是 `packages/api/src/router/execute-turn.ts`:系统命令 → 多 `@` 同题并行 → 每条链同步 A2A → `#learn` → `git diff` 建卡并拉审查。

交接对象在名册 `handoffTo` / `handoff`,不写进 TypeScript 分支。存储只依赖 `stores/ports.ts`。

和 clowder 对齐的是行首 `@`、`@owner` 语义、交接包给人看。我们不搬 mailbox、SOP Guardian、MCP、`hold_ball`。

## 用 curl 走同一圈

```bash
THREAD=$(curl -sS -X POST localhost:3200/api/threads \
  -H 'content-type: application/json' \
  -d '{"title":"演示-沙箱 add.ts"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -sS -X POST "localhost:3200/api/threads/$THREAD/messages" \
  -H 'content-type: application/json' \
  -d '{"content":"在沙箱写 add.ts,导出 add(a,b),写完自检。"}'
# 等返回后看消息里的 ap_xxxxxxxx,再:
# curl -sS -X POST "localhost:3200/api/threads/$THREAD/messages" \
#   -H 'content-type: application/json' \
#   -d '{"content":"#approve ap_xxxxxxxx"}'
```

一次完整流程大约 $0.2–0.4(视模型和是否自检而定)。
