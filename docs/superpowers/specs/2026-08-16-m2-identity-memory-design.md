# M2 设计文档:持久身份 + 共享记忆

- 日期:2026-08-16
- 状态:已批准(用户在会话中确认设计,含 agent 命名:墨墨/闪闪/团团)
- 依赖:M1 骨架(端口-适配器存储、executeTurn 路由、ClaudeAdapter 已支持 `systemPrompt` → `--append-system-prompt`)
- 总设计参考:`2026-08-16-meowbase-design.md` §4.4

## 1. 目标

1. **持久身份**:每个 agent 有 profile(名字/性格/角色/擅长),存 Redis,跨会话保持;新会话启动时注入身份到 system prompt
2. **共享记忆(证据库)**:三类条目(事实/教训/决策),经"建议 → 确认"流程写入;消息中 `#ev_<id>` 引用可把历史证据注入当前会话

## 2. 非目标(M2 明确不做)

gemini/opencode 适配器、Web UI、自动沉淀判断(见 §5 触发条件说明)、profile 修改接口(只读 + 种子)、证据检索/全文搜索。

## 3. 数据模型(shared 类型)

```ts
export type EvidenceKind = 'fact' | 'lesson' | 'decision';
export type EvidenceStatus = 'draft' | 'confirmed';

export interface AgentProfile {
  agentId: AgentId;      // 'claude' | 'gemini' | 'opencode'
  name: string;          // 墨墨 / 闪闪 / 团团
  personality: string;   // 性格描述
  role: string;          // 角色一句话
  expertise: string[];   // 擅长领域
  createdAt: string;
}

export interface EvidenceEntry {
  id: string;            // 'ev_' + 8 位短 id
  threadId: string;
  kind: EvidenceKind;
  title: string;
  content: string;
  status: EvidenceStatus; // draft → confirmed
  createdAt: string;
}
```

Message 模型扩展:`MessageRole` 增加 `'system'`(用于建议沉淀消息与系统回执)。

## 4. 种子 profile

启动时若 Redis 无记录则写入三个种子:

| agentId | 名字 | 性格 | 角色 | 擅长 |
|---|---|---|---|---|
| claude | 墨墨 | 沉稳细致,爱写注释 | 主力写手 | 架构设计、TypeScript、代码实现 |
| gemini | 闪闪 | 活泼,点子多 | 审查官/创意 | 代码审查、方案评审、头脑风暴 |
| opencode | 团团 | 圆润可靠,话不多 | 执行者 | 多模型兼容、工具调用、脚本 |

## 5. 沉淀流程(#learn / #confirm 消息协议)

**触发条件决策(与总设计的差异,需留意)**:总设计写"agent 完成任务后自动建议"。为避免每轮都产生一条噪音 draft,M2 改为**显式触发**:用户消息里带 `#learn <标题>` 时,该轮结束后系统生成 draft + 建议消息;`#confirm ev_xxx` 批准入库。行为等价(建议→确认→写入),触发从自动改为显式;自动建议留给有 UI 的 M4。

**协议**(纯文本,将来 Web UI 直接复用):

- 用户消息含 `#learn <标题>` → 该轮 assistant 回复后:
  - 系统创建 draft 条目(id=`ev_` + 8 位随机,标题取 `#learn` 后的文本,内容取 assistant 回复全文,kind 默认 `fact`)
  - 系统追加一条 system 消息:`💡 建议沉淀为证据:「<标题>」\n回复 #confirm <id> 确认`
- 用户消息为 `#confirm <ev_id>`:
  - 校验条目存在且为 draft → 置为 confirmed,系统回执 `✅ 已沉淀:<标题>`
  - 不存在/已确认 → 系统回执 `⚠️ 找不到可确认的证据:<id>`
  - 该消息**不路由给 agent**(纯系统操作)

**解析函数**(shared,纯函数,TDD):
- `parseLearnCommand(content): { title: string } | null` —— 匹配 `#learn <标题>`(标题取到行尾)
- `parseConfirmCommand(content): { id: string } | null` —— 匹配 `#confirm ev_<8位>`
- `parseEvidenceRefs(content): string[]` —— 匹配所有 `#ev_<8位>`

## 6. 引用注入(#ev_)

消息含 `#ev_<id>` → executeTurn 在调用 agent 前,取这些 id 的 confirmed 条目,拼进 system prompt 附加段:

```
团队记忆:
- [fact] <标题>: <内容>
- [lesson] <标题>: <内容>
```

## 7. 身份注入

- **仅新会话注入**(thread.sessions[agentId] 为空时):把 profile 拼为 system prompt 基础段,经 `runTurn({ systemPrompt })` → `claude --append-system-prompt`
- resume 会话不重复注入(上下文里已有身份)
- **注入拼装纯函数**(shared,可测):

```ts
export function buildSystemPrompt(input: {
  profile?: AgentProfile;
  evidenceRefs: EvidenceEntry[];
}): string | undefined
// 无 profile 且无引用 → undefined(不传 --append-system-prompt)
```

## 8. 存储扩展(端口-适配器)

- `ProfileStore`: `get(agentId): Promise<AgentProfile | null>`、`list(): Promise<AgentProfile[]>`
- `EvidenceStore`: `createDraft({threadId, kind, title, content}): Promise<EvidenceEntry>`、`confirm(id): Promise<EvidenceEntry | null>`、`get(id): Promise<EvidenceEntry | null>`、`list(threadId?): Promise<EvidenceEntry[]>`
- 内存实现 + Redis 实现,`factories.ts` 追加工厂;种子写入 `ensureSeededProfiles(store)` 在服务启动时调用
- Redis key:`profile:{agentId}`(hash)、`evidence:{id}`(hash)、`evidence:index`(set)

## 9. API(只读)

- `GET /api/profiles` → 全部 profile
- `GET /api/evidence?threadId=` → 证据列表(可按线程过滤)

## 10. executeTurn 流程变更

1. 解析 `#confirm`:命中 → 走证据确认,返回系统回执,不调 agent
2. 解析 `#learn`:命中 → 记录请求标记,正常路由执行
3. 解析 `#ev_` 引用 → 取 confirmed 条目
4. 组装 systemPrompt:profile(仅新会话)+ 引用证据
5. 执行后:若本消息带 `#learn` 且 assistant 完成 → 创建 draft + 建议消息
6. 其余行为不变

## 11. 测试策略

- shared 纯函数 TDD:三个解析函数 + buildSystemPrompt
- 存储:内存实现单测;Redis 实现走真实 Redis 测试(可用时)
- executeTurn 集成(内存存储 + stub provider):
  - `#confirm` 确认成功/失败回执、不调 agent
  - `#learn` 生成 draft + 建议消息
  - `#ev_` 注入:断言 stub 收到的 systemPrompt 含证据内容
  - 新会话注入 profile;resume 不注入
- 适配器:补一条 ClaudeAdapter 测试,断言 args 包含 `--append-system-prompt`(fake CLI)

## 12. 验收标准

1. `pnpm test` 全绿(新增用例数 ≥ 15)
2. fake 冒烟通过;重启 API 后 profile/证据仍在(Redis 持久化)
3. 手工验证(可选,付费):真实 `claude` 新会话回复带身份;`#learn` + `#confirm` 全流程走通;`#ev_` 引用生效
