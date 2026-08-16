# M4 设计文档:跨模型互审 + 审批流

- 日期:2026-08-16
- 状态:已批准(用户在会话中确认:有 diff 自动审查)
- 依赖:M1-M3(executeTurn、SkillStore、ProfileStore、EvidenceStore)
- 总设计参考:`2026-08-16-meowbase-design.md` §4.6

## 1. 目标

写手 agent 完成任务产生文件改动后,平台自动生成审批卡片,由另一 agent 审查,人类通过消息协议批准/打回。

## 2. 前置:OpenCodeAdapter

- 新适配器 `opencode run <prompt> --format json [-s <sessionId>] [-m <model>]`
- 已用真实输出验证格式(2026-08-16 录制):
  - `{"type":"text", sessionID, part:{type:"text", text:"增量"}}` → 文本增量
  - `{"type":"step_finish", sessionID, part:{tokens:{input,output,cache:{read,write}}, reason}, cost}` → 完成 + usage
- sessionId 支持 `--session` 续聊;`-m` 模型由 config 配置(默认 `opencode-go/deepseek-v4-flash`)
- golden fixture 用真实输出;fake bin 供测试

## 3. diff 来源:线程工作目录 git 化

- 线程创建时:`git init` + 本地 user 配置 + `git commit --allow-empty`(空基线)
- 每轮完成后:`git add -A` + `git diff HEAD` → `{ stat, text }`(text 截断 20k 字符)
- 无改动 → null → 不触发审批
- git 辅助函数:`packages/api/src/services/git.ts`(execFile 封装)

## 4. 数据模型(shared 类型)

```ts
export type ApprovalStatus = 'draft' | 'reviewing' | 'approved' | 'rejected' | 'applied';

export interface ApprovalCard {
  id: string;              // 'ap_' + 8 位
  threadId: string;
  writerAgentId: AgentId;
  reviewerAgentId: AgentId;
  status: ApprovalStatus;
  diffText: string;
  diffStat: string;
  reviewComment?: string;
  rejectReason?: string;
  createdAt: string;
}
```

## 5. 存储

`ApprovalStore` 端口 + 内存/Redis 实现(factories 扩展):
- `create({threadId, writerAgentId, reviewerAgentId, diffText, diffStat}) → ApprovalCard`(status draft)
- `get(id)`、`list(threadId?)`
- `approve(id)`(draft/reviewing → approved,否则 null)、`reject(id, reason)`(→ rejected)、`markApplied(id)`(approved → applied)

## 6. 审查配对

- 纯函数 `selectReviewer(writer, available): AgentId | undefined`:优先固定配对(claude↔opencode),否则选第一个不等于 writer 的可用 agent;无则 undefined(不审查,卡片仍创建并提示)
- `AgentRegistry` 增加 `list(): AgentId[]`
- 审查调用:reviewer 的 runTurn,prompt = `请作为审查官审查以下代码改动…` + diff;systemPrompt = reviewer profile + review 技能(从 SkillStore 取 id='review',取不到则无技能段)

## 7. executeTurn 流程变更

1. 新增 `#approve ap_xxx` 分支:approve → git commit 基线(落地)→ markApplied → 系统回执 `✅ 已批准并落地:<id>`
2. 新增 `#reject ap_xxx <理由>` 分支:reject(reason)→ 系统回执 `⛔ 已打回:<id> 理由:…`
3. 正常轮完成后:gitDiff → 有 diff → 创建卡片(draft)→ 自动审查(reviewer)→ 存意见 → 系统消息:
   ```
   📋 审批卡片 ap_xxxx(墨墨 写 → 团团 审)
   改动文件:…(diffStat)
   审查意见:…(reviewComment)
   回复 #approve ap_xxxx 批准 / #reject ap_xxxx <理由> 打回
   ```
4. 命令解析(shared):`parseApproveCommand`、`parseRejectCommand`

## 8. 范围控制(非目标)

git 冲突合并、rejected 自动回滚、多轮打回往返、卡片 UI(M5)、OpenCodeAdapter 的复杂错误分类。

## 9. 测试策略

- shared:命令解析 + selectReviewer 纯函数 TDD
- api:ApprovalStore 内存/Redis;git 辅助函数在真实临时 git 仓库验证(init/diff/commit)
- OpenCodeAdapter:真实录制 fixture golden test + fake bin 测试
- executeTurn:有 diff→卡片+审查意见(断言 reviewer 被调用且收到 diff);无 diff→无卡片;#approve/#reject 状态流转;审查 agent 不可用→卡片仍创建
- http:集成一条完整"写→审→批"链路

## 10. 验收标准

1. `pnpm test` 全绿(新增用例 ≥ 15)
2. 集成测试证明完整链路:写手改动文件 → 卡片+审查意见 → #approve → applied(git 基线提交)
3. fake 冒烟:claude + opencode 双适配器跑通
