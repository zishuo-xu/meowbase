# 技能：触发词当轮注入

- 状态:`已落地`
- 对照 clowder:公开 Skills = 按需加载 prompt。TIPS 拉闸词是另一套紧急刹车。我们技能用 manifest；`星星罐子` 是停棒（不调猫），其余拉闸词当技能注入对照。
- 相关:[execute-turn.md](execute-turn.md)

## 功能

当跳任务正文命中触发词（如 `tdd`、`脚手架`）时，把对应 md 拼进这一跳 system prompt。加技能 = 加文件，不改路由。人消息里的词不一定带到下一只。

## 价值

不把 TDD/审查手册常驻在每只猫的上下文里，省 token，也避免「永远用审查口吻写代码」。

## 愿景

技能是邮差袋子里的说明书，不是 SOP 引擎。猫仍自己想；平台只在被喊到时塞一页。

## 架构落点

`skills/manifest.json` + `skills/prompts/*.md`。`runSegment` 对**当跳任务正文**做 `matchSkills`，交给 `buildSystemPrompt`。第一跳是人的正文，交棒之后是平台拼的交接任务。

## 为什么这样设计

| # | 决策 | 理由 |
|---|---|---|
| D1 | 触发词注入，不常驻 | 对齐他们 on-demand；上下文是地板不是仓库 |
| D2 | `星星罐子` 整行 = 停棒，不是技能 | 拉闸必须硬轨，不能靠模型「看了技能再决定停不停」 |
| D3 | `脚手架` / `绕路了` / `喵约` 当技能 | 对齐 TIPS 语义：停下来对照；我们不另开协议 |

## 怎么做

manifest 加 `{ id, triggers, prompt 路径 }`。验收：消息含 `tdd` 时 system prompt 出现 TDD 段；整行 `星星罐子` 不调猫。

## 不做什么

- 不做 SOP 阶段机、愿景守护、设计门禁（他们 `docs/SOP.md` 那套）
- 不按风险自动选技能

## 面试能讲

- **30 秒**：技能是按需说明书。拉闸里只有「星星罐子」是平台停棒，其余是给猫看的对照页。
- **追问「和 system prompt 长期人设有何不同」**：人设每跳都在（你是墨墨）；技能只在这轮被喊到才出现。
- **若继续往 clowder 靠**：他们技能目录和 MCP 描述有质量门禁。我们保持「加 md 即可」，质量靠人审文件。

## 代码入口

- `skills/manifest.json`、`skills/prompts/`
- `packages/shared/src/system-prompt.ts`
