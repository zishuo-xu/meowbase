# 确认了就写成文件

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F102 —— 知识真相在 .md,索引是可扔掉再编的产物。批准之后才物化。
- 靠拢:拿「人点确认才写成文件,Redis/内存只是索引,文件在就能重建」。不做向量库、不自动 git commit。

## 门（各一句）

- **功能**：`#confirm` 之后这条证据落成 `memory/ev_xxx.md`。索引清空后,扫这批文件能重建已确认条目。
- **价值**：面试能指着文件说「公共记忆不是 Redis 里的黑盒」;机器重装只要文件还在。
- **愿景**：仍是邮差。人签过的信有纸本;目录只是方便找。
- **落点**：纯函数排版/回读;`#confirm` 写文件;`rebuildEvidenceFromFiles` 灌回 store。

## 为什么

现在确认只改 Redis 状态。对照他们:没写成 .md 就不算沉淀。喵窝差的是纸本。不做成 X:简历讲记忆治理,演示时 Redis 一 FLUSH 全没了。

draft 仍只在索引里。没确认不落文件。

## 怎么做

1. `formatEvidenceMarkdown` / `parseEvidenceMarkdown`:frontmatter 含 id / kind / title / threadId / confirmedAt,正文是 content。
2. `#confirm` 成功后写 `MEMORY_DIR/ev_xxx.md`(默认 `./memory`)。写失败仍算确认成功,回执带一句没写成文件。
3. `rebuildEvidenceFromFiles(dir, store)`:读目录里 `ev_*.md`,upsert 成 confirmed。文件是真相,索引没有的补上,有的按文件覆盖。
4. 验收:确认一条 → 文件在、正文对;把 store 清空再 rebuild → `get(id)` 仍是 confirmed。

## 不做（本篇）

- 自动 git commit / 绑仓仓内另写一份
- 向量索引、draft 也落盘
- 删除/编辑已确认文件的 Hub 表单

## 入口

- 排版/回读:`packages/shared/src/evidence-files.ts`
- 写文件/重建:`packages/api/src/services/evidence-files.ts`
- 确认时物化:`packages/api/src/router/turn/system-commands.ts`
- 开机重建:`packages/api/src/app.ts` `rebuildEvidenceFromFiles`
