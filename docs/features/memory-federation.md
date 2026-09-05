# 记忆联邦检索

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F186 —— Collection 之间知识不自动互通;跨域结果必须标出处;默认召回只看本项目,伸到整座图书馆得人点名。
- 靠拢:拿「人能搜到别的仓,命中标成别的项目,自动召回仍不灌」。差在独立 Collection 实体和删除/编辑:本篇把一座仓当成一座馆藏,生命周期另开。

## 门（各一句）

- **功能**：Hub 记忆页能按关键词搜全部已确认证据;跨仓命中写明来自哪座仓。
- **价值**：人要借别的项目那条约定时找得到 id,面试能讲「搜得到不等于灌进去」。
- **愿景**：仍是邮差。平台不判断该不该借,只标清是不是本仓的,自动那条路继续划界。
- **落点**：`searchEvidenceHits`;`GET /api/evidence?q=`;Hub 记忆页搜索框。不改自动召回,不新开心脏。

## 为什么

划界已经拦住「之前我们约定」把别仓灌进提示词。对照他们:图书馆能检索,但跨馆藏必须贴标签,默认不进当前项目。喵窝现在人在 Hub 只能看注入次数,找不到别仓那条 `ev_xxx`,点名跨界形同虚设。不做成 X:自动召回绿、人要借时两眼一抹黑。

馆藏不另建表:绑了仓的线程以仓库路径为馆;空沙箱以本线程为馆。和现有划界同一把尺。

## 怎么做

1. `searchEvidenceHits({ query, entries, threads, current })`:只搜已确认;关键词打分同 `matchEvidence`,不要求「之前/约定」。`current` 有则用 `filterEvidenceByRecallScope` 标 `foreign`;没有则命中都不标外馆。
2. `GET /api/evidence?q=斑马纹&threadId=` 走搜索,返回条目外加 `source` / `foreign`。没 `q` 仍是原来的 list / recall。
3. Hub 记忆页一个搜索框。外馆命中写「别的项目 · 点 #ev_ 才进提示词」。侧栏证据条仍只显示本范围,不把外馆漏进当前线程。
4. 验收:仓 A 确认的条,在仓 B 的 `q=` 搜得到且 `foreign=true`;「之前约定」自动召回仍灌不进 B;点名 `#ev_` 仍能进 B。

## 不做（本篇）

- 独立 Collection CRUD、敏感级、权威分
- 删除 / 编辑 / Feed 审阅
- 改自动召回模型、向量检索

## 入口

- 纯函数:`packages/shared/src/evidence-recall.ts` `searchEvidenceHits`
- 接口:`GET /api/evidence?q=`(`packages/api/src/http/server.ts`)
- Hub:`packages/web/components/TeamHub.tsx` 记忆页搜索框
- 协议:[AGENTS.md](../../AGENTS.md) 人打的表 `#ev_` / 「之前约定」
