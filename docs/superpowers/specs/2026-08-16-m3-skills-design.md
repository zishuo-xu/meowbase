# M3 设计文档:Skills 按需加载

- 日期:2026-08-16
- 状态:已批准(用户在会话中确认设计)
- 依赖:M1 骨架、M2 身份/记忆注入(buildSystemPrompt 已有 profile + evidenceRefs 两段)
- 总设计参考:`2026-08-16-meowbase-design.md` §4.5

## 1. 目标

技能按需注入:消息命中技能触发词时,把技能 prompt 追加到本轮 systemPrompt(叠加在身份之后、团队记忆之前);不命中则不注入,不常驻上下文。

## 2. 非目标(M3 明确不做)

技能的增删改 API、技能评分/自动触发、每技能独立会话、技能持久化到 Redis(文件式,技能是代码的一部分)。

## 3. 数据模型(shared 类型)

```ts
export interface Skill {
  id: string;            // 'tdd' | 'review' | 'debug'
  name: string;          // 显示名,如 '测试驱动开发'
  description: string;   // 一句话描述
  triggers: string[];    // 触发关键词,大小写不敏感包含匹配
  prompt: string;        // 技能 prompt 全文(加载自 md 文件)
}
```

## 4. 技能存储(文件式)

```
skills/
├── manifest.json        # [{ id, name, description, triggers, promptFile }]
└── prompts/
    ├── tdd.md
    ├── review.md
    └── debug.md
```

- `SkillStore` 端口:`list(): Promise<Skill[]>`、`get(id): Promise<Skill | null>`
- `FileSkillStore(dir)`:读 manifest.json → 逐个加载 prompts/<promptFile> → 组装 Skill
- 内存实现供测试;启动时 index.ts 装配 `createSkillStore(config.skillsDir)`
- config 新增 `skillsDir`,默认 `./skills`

## 5. 内置三个技能

| id | name | triggers | prompt 要点 |
|---|---|---|---|
| tdd | 测试驱动开发 | tdd、测试驱动 | 红-绿-重构循环、先写失败测试、最小实现 |
| review | 代码审查 | review、审查、代码评审 | 审查清单:正确性/边界/安全/可读性/测试 |
| debug | 系统化调试 | debug、调试、bug | 复现→假设→二分→验证、先读错误再改码 |

## 6. 匹配与注入

- 纯函数 `matchSkills(content: string, skills: Skill[]): Skill[]` —— 消息包含任一触发词即命中(大小写不敏感)
- `buildSystemPrompt` 扩展:input 增加 `skills?: Skill[]`,输出段顺序:**身份 → 技能 → 团队记忆**

```
你是 墨墨,主力写手。性格:...
本轮请遵循以下技能:
[技能:测试驱动开发] 红-绿-重构...
团队记忆:
- [fact] ...
```

- executeTurn:每轮 `matchSkills(content, await skills.list())` → 传入 buildSystemPrompt;技能只在命中那轮生效

## 7. API

- `GET /api/skills` → 全部技能(只读,演示用)

## 8. 测试策略

- shared:`matchSkills` 纯函数 TDD(大小写/部分匹配/多技能/无命中);buildSystemPrompt 技能段追加用例
- api:FileSkillStore 用测试 fixtures 加载;InMemorySkillStore;executeTurn 命中/不命中/多技能注入断言
- http:GET /api/skills 集成

## 9. 验收标准

1. `pnpm test` 全绿(新增用例 ≥ 12)
2. 集成测试证明:命中 → systemPrompt 含技能文本;不命中 → 不含
3. fake 冒烟保持通过
