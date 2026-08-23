# 演示与架构一页

给自己录 1–2 分钟、或给简历讲项目用。对照 clowder:他们闭环后放多猫演示;我们演的是**一场接力**,不演邮箱/SOP。

协议(谁打什么、平台做什么)只写在 [AGENTS.md](../AGENTS.md) 协议表。下面只写点哪里、看到什么。猫怎么交棒、传什么,见 [A2A.md](A2A.md)。

## 你点哪里,期望看见什么

1. 打开 http://localhost:3300,点 **+ 新会话**。
2. 只说目标,或另起一行点名。例如:

   ```
   在沙箱写 add.ts,导出 add(a,b),写完自检。
   @墨墨
   ```

   换行按 **Shift+Enter**（Enter 直接发送）。打 `@` 时会弹补全，此时 **Enter 是选候选不是发送**，先 `Esc` 关掉、或 `Tab`/`Enter` 选完再发。发出后应当看到用户气泡里 `@墨墨` **自己占一行**；如果挤成一段或第一行被单独发走了，说明这两条没测到。点名规则见 [AGENTS.md](../AGENTS.md) 协议表。

3. 期望:
   - 侧栏标题变成任务摘要(不是时间戳)
   - 墨墨改沙箱、回复里带本轮命令和结果
   - 行首 `@闪闪` → `🤝 接力:墨墨 → 闪闪`,顶栏球在闪闪;点「交接包」能看到目标和任务
   - 写完有改动却忘了行首 `@` → 墨墨会再开口一次;仍没有才「球还在地上」
   - 行首 `@` 了但这一跳空手 → 不传,顶栏「球还在地上」(长方案没改文件仍会交)
   - 闪闪由平台接着跑,不必再发「继续」;写出「通过」后顶栏立刻「球在人手里」;写出「需修改」后先看到「球在写手手上」,审批卡一出顶栏改成「球在人手里」
   - 有改动时审批卡在闪闪跑完后出;侧栏该会话标 **待确认**;点进去滚到审批卡
4. 你点批准。期望顶栏变成 **已落地,等人开口**。

崩溃恢复(最值得演):第 3 步闪闪正在想、卡还没出来时下手。操作步骤以 [AGENTS.md](../AGENTS.md) 踩坑第 1 条为准(`lsof -ti :3200 | xargs kill -9`,再自己起一次 API;`tsx watch` 崩了不会重生)。不要发「继续」。期望:半截气泡标失败(「平台重启,这一跳没写完」),同一只猫自己接着跑完,审批卡自己出来。

下面是某次真实记录(快照,不是每次都长这样):22:22:23 杀进程,Redis 里那一棒还在(`pendingHop.id = eebe6ef7`);22:22:39 重启(隔 16 秒),日志依次 `resume sweep n=1` → `resume steal thread=6a920e0d` → `pending follow to=gemini` → `hop start agent=gemini`。审计留下 `lease-steal` → `hop-failed` → `hop-rerun` → 22:23:32 `hop-done`,**全程同一个 hopId**。死者那把 60 秒租约还没过期,开机那一扫会强抢(单实例下没有活主人),所以立刻续跑而不是干等;重跑是真的重新推理。代价:强抢假设单实例,多开一个 API 这条会破。

升级拍板(可选):让墨墨在两个方案里选一个。它行首写 `@人` 后,顶栏应是「球在人手里:墨墨请求拍板」,`💡` 提示不会盖住这句话。

持球(可选):墨墨行首写 `等 测试跑完` 后,顶栏「球在等:墨墨」,没有「球还在地上」,当轮不出审批卡。你再说一句,持球结束。行首 `等跑 npm test` 则由平台在沙箱跑测试,跑完再叫墨墨看结果。带分号、管道或 `node -e` 时顶栏球回人手里。

记忆(可选):先 `#learn 用户偏好 TypeScript` → `#confirm ev_…`,再新开线程说「之前我们约定用 TypeScript」。猫应带着这条证据开口,不必手打 `#ev_`。

拉闸(可选):另起一行只写 `星星罐子`,顶栏变成「已拉闸,等人开口」,本轮不再叫猫。走偏时说 `脚手架` / `绕路了` / `喵约`,当轮注入对照技能。

Hub(可选):打开团队 Hub → 能力,应看见墨墨主架构师、闪闪审查官、团团执行者。只读名册,不改路由。

账本(可选):打开团队 Hub → 账本,切「当前线程 / 全部」。也可 `curl "localhost:3200/api/usage?threadId=t_xxx"`。期望只算跑完的助手消息,半截的和失败的不算钱。今晚那条链:墨墨 输入 21,171 / 输出 1,936 / 缓存读 107,008 / 总计 130,115 / **$0.2078**;闪闪 输入 179 / 输出 557 / 缓存读 10,880 / 总计 13,465 / **无成本数据**;团团没出场,整行 `—`。没报成本就写「无成本数据」,不按价格表估(价格会变、缓存折扣算不清,估出来的数字比没有数字更能骗人);「无成本数据」和「—」是两回事(跑过但没报邮资 vs 没出场)。

审计(可选):`curl "localhost:3200/api/audit?threadId=t_xxx"`(倒序;可加 `actor` / `action` / `since` / `limit`)。期望按线程能回放谁开口、谁交给谁、哪张卡被建过、哪一跳抢到了租约。平台的决定在 store 边界自动落存根;租约事件(`lease-claim` / `lease-steal`)和半截重跑(`hop-rerun`)仍显式补,见 [AGENTS.md](../AGENTS.md) 开发约定「审计不用手写」。`lease-claim` 和后面那条 `hop-done` 是同一个 hopId,能证明这一跳走的是持久化那条路。纯系统命令（`#approve` / `#confirm` / 星星罐子）没有棒,不落租约行。今晚一条交棒链(正序,数字未改):

```
14:10:32  human     user-say           '@墨墨 在沙箱写 slug.ts…'
14:11:21  claude    hop-done           usage: 21171 in / 1936 out / 107008 cacheRead / $0.207759
14:11:22  platform  relay              {from: claude, to: gemini}
14:11:22  platform  lease-claim        hopId 02fd2845
14:12:06  gemini    hop-done           hopId 02fd2845
14:12:06  platform  approval-created   ap_32c18012
14:12:06  platform  approval-pending
14:12:06  platform  lease-release
```

## 简历口播(约 40 秒)

1. 这是多 Agent 协作平台,不是 Chat UI。模型推理,CLI 干活,平台只做邮差。
2. 平台管路由、线程、身份、记忆、技能、审批、审计。人拍板,猫推理。
3. 心脏是一条 `executeTurn`:系统命令 → 多 @ 并行 → A2A 接力 → 沉淀 → diff 建卡拉审查。
4. 交接对象在名册 `handoffTo`,不写 `if (claude)`。
5. 谁打什么、平台做什么,见 [AGENTS.md](../AGENTS.md) 协议表。演示里能看见行首交棒、升级、持球、顶栏球权。
6. 存储只依赖端口,Redis 可换。适配器统一 `runTurn`。
7. 和 clowder 对齐的是语义:行首 mention、升级给人、交接包给人看。
8. 不搬他们的邮箱、SOP、MCP、队列。我们是一场接力,不是猫窝操作系统。
9. 沙箱是每条线程的 cwd 真相源;审批 diff 不含 `node_modules`。
10. 证据能被「之前约定」问出来;人也能一句话拉闸。
11. 交棒那一棒不怕重启:跑完落库才清,开机扫强抢未过期的租约(单实例)。花了多少看 Hub 账本,没报就不估;发生过什么 `GET /api/audit`。

## 架构(简历可讲)

三层:**模型**推理 → **Agent CLI** 干活 → **平台**管路由、线程、身份、记忆、技能、审批、审计。平台不替猫想。

心脏是 `packages/api/src/router/execute-turn.ts`:系统命令 → 多 `@` 同题并行 → 每条链 A2A 接力(交棒后本轮先结束,平台自己续跑) → `#learn` → `git diff` 建卡并拉审查。

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

# 走完同一圈之后还能查:
# curl "localhost:3200/api/audit?threadId=$THREAD"
# curl "localhost:3200/api/usage?threadId=$THREAD"
```

一次完整流程大约 $0.2–0.4(视模型和是否自检而定)。今晚那条链墨墨一跳 $0.2078,闪闪无成本数据。
