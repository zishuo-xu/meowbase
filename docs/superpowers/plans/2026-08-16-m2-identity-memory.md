# M2 实现计划:持久身份 + 共享记忆

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent 拥有跨会话保持的 profile 身份,新会话自动注入;团队证据库支持 `#learn` 沉淀、`#confirm` 确认、`#ev_` 引用注入。

**Architecture:** 沿用端口-适配器:新增 ProfileStore / EvidenceStore(内存 + Redis);`executeTurn` 增加三条消息协议分支(`#confirm` / `#learn` / `#ev_`)并组装 systemPrompt(profile 仅新会话注入 + 引用证据);身份注入走已有 `AgentTurnInput.systemPrompt` → `claude --append-system-prompt`。

**Tech Stack:** 同 M1(TS 严格模式 / Fastify / ioredis / vitest)。新增 shared 纯函数:`commands.ts`(解析)、`system-prompt.ts`(拼装)。

## Global Constraints

- 沿用 M1 全部约束(ESM `.js` 后缀导入、业务只依赖 ports、biome、提交规范)
- 消息协议:`#learn <标题>`、`#confirm ev_<8位>`、`#ev_<8位>`;证据 id 一律 `ev_` + 8 位十六进制
- `#confirm` 消息不路由给 agent;`#learn` 仅在 assistant 完成(completed)时生成 draft
- profile 注入仅当 `thread.sessions[agentId]` 为空(新会话);引用证据任意轮次都注入
- 新增用例总数 ≥ 15

---

### Task 1: shared 类型扩展 + 消息协议解析(纯函数 TDD)

**Files:**
- Modify: `packages/shared/src/types.ts`(追加 4 个类型;MessageRole 加 'system')
- Create: `packages/shared/src/commands.ts`
- Create: `packages/shared/test/commands.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `AgentProfile`、`EvidenceEntry`、`EvidenceKind`、`EvidenceStatus` 类型;`generateEvidenceId(): string`;`parseLearnCommand(content): { title: string } | null`;`parseConfirmCommand(content): { id: string } | null`;`parseEvidenceRefs(content): string[]`

- [ ] **Step 1: 写失败测试**

`packages/shared/test/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  generateEvidenceId,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
} from '../src/commands.js';

describe('generateEvidenceId', () => {
  it('生成 ev_ + 8 位 id,且不重复', () => {
    const a = generateEvidenceId();
    const b = generateEvidenceId();
    expect(a).toMatch(/^ev_[a-f0-9]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe('parseConfirmCommand', () => {
  it('解析 #confirm ev_xxx', () => {
    expect(parseConfirmCommand('#confirm ev_ab12cd34')).toEqual({ id: 'ev_ab12cd34' });
  });

  it('普通消息返回 null', () => {
    expect(parseConfirmCommand('今天天气不错')).toBeNull();
    expect(parseConfirmCommand('#confirm 不是证据id')).toBeNull();
  });
});

describe('parseLearnCommand', () => {
  it('解析 #learn 标题', () => {
    expect(parseLearnCommand('#learn 用户偏好 TypeScript')).toEqual({ title: '用户偏好 TypeScript' });
  });

  it('标题为空返回 null', () => {
    expect(parseLearnCommand('#learn   ')).toBeNull();
    expect(parseLearnCommand('普通消息')).toBeNull();
  });
});

describe('parseEvidenceRefs', () => {
  it('解析多个 #ev_ 引用', () => {
    expect(parseEvidenceRefs('查一下 #ev_a1b2c3d4 和 #ev_ef012345')).toEqual([
      'ev_a1b2c3d4',
      'ev_ef012345',
    ]);
  });

  it('无引用返回空数组', () => {
    expect(parseEvidenceRefs('没有引用')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/shared exec vitest run test/commands.test.ts`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现**

`packages/shared/src/types.ts`(追加):

```ts
export type EvidenceKind = 'fact' | 'lesson' | 'decision';
export type EvidenceStatus = 'draft' | 'confirmed';

export interface AgentProfile {
  agentId: AgentId;
  name: string;
  personality: string;
  role: string;
  expertise: string[];
  createdAt: string;
}

export interface EvidenceEntry {
  id: string;
  threadId: string;
  kind: EvidenceKind;
  title: string;
  content: string;
  status: EvidenceStatus;
  createdAt: string;
}
```

同时把 `MessageRole` 改为:

```ts
export type MessageRole = 'user' | 'assistant' | 'system';
```

`packages/shared/src/commands.ts`:

```ts
import { randomBytes } from 'node:crypto';

export function generateEvidenceId(): string {
  return `ev_${randomBytes(4).toString('hex')}`;
}

const CONFIRM_PATTERN = /#confirm\s+(ev_[a-f0-9]{8})\b/;

export function parseConfirmCommand(content: string): { id: string } | null {
  const match = content.match(CONFIRM_PATTERN);
  return match?.[1] ? { id: match[1] } : null;
}

const LEARN_PATTERN = /#learn\s+(.+)$/;

export function parseLearnCommand(content: string): { title: string } | null {
  const match = content.match(LEARN_PATTERN);
  if (!match) return null;
  const title = match[1].trim();
  return title ? { title } : null;
}

const EVIDENCE_REF_PATTERN = /#ev_([a-f0-9]{8})\b/g;

export function parseEvidenceRefs(content: string): string[] {
  return [...content.matchAll(EVIDENCE_REF_PATTERN)].map((m) => m[1]).filter((x): x is string => x !== undefined);
}
```

`packages/shared/src/index.ts`(追加导出):

```ts
export type { AgentProfile, EvidenceEntry, EvidenceKind, EvidenceStatus } from './types.js';
export {
  generateEvidenceId,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
} from './commands.js';
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 8 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(shared): 证据/Profile 类型 + 消息协议解析"
```

---

### Task 2: buildSystemPrompt 拼装(纯函数 TDD)

**Files:**
- Create: `packages/shared/src/system-prompt.ts`
- Create: `packages/shared/test/system-prompt.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `AgentProfile`、`EvidenceEntry`(Task 1)
- Produces: `buildSystemPrompt({ profile?, evidenceRefs }): string | undefined` —— 无内容返回 undefined(不传注入参数)

- [ ] **Step 1: 写失败测试**

`packages/shared/test/system-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/system-prompt.js';
import type { AgentProfile, EvidenceEntry } from '../src/types.js';

const profile: AgentProfile = {
  agentId: 'claude',
  name: '墨墨',
  personality: '沉稳细致',
  role: '主力写手',
  expertise: ['架构设计', 'TypeScript'],
  createdAt: '2026-08-16T00:00:00.000Z',
};

const evidence: EvidenceEntry = {
  id: 'ev_a1b2c3d4',
  threadId: 't1',
  kind: 'fact',
  title: '用户偏好 TS',
  content: '用户明确表示喜欢 TypeScript',
  status: 'confirmed',
  createdAt: '2026-08-16T00:00:00.000Z',
};

describe('buildSystemPrompt', () => {
  it('仅 profile:拼出身份段', () => {
    const prompt = buildSystemPrompt({ profile, evidenceRefs: [] });
    expect(prompt).toContain('你是 墨墨,主力写手');
    expect(prompt).toContain('性格:沉稳细致');
    expect(prompt).toContain('擅长:架构设计、TypeScript');
  });

  it('仅引用:拼出团队记忆段', () => {
    const prompt = buildSystemPrompt({ evidenceRefs: [evidence] });
    expect(prompt).toContain('团队记忆');
    expect(prompt).toContain('[fact] 用户偏好 TS: 用户明确表示喜欢 TypeScript');
  });

  it('两者都有:分段拼接', () => {
    const prompt = buildSystemPrompt({ profile, evidenceRefs: [evidence] });
    expect(prompt).toContain('你是 墨墨');
    expect(prompt).toContain('团队记忆');
    expect(prompt?.indexOf('团队记忆') ?? -1).toBeGreaterThan(prompt?.indexOf('你是 墨墨') ?? -1);
  });

  it('都为空返回 undefined', () => {
    expect(buildSystemPrompt({ evidenceRefs: [] })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @meowbase/shared exec vitest run test/system-prompt.test.ts`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现**

`packages/shared/src/system-prompt.ts`:

```ts
import type { AgentProfile, EvidenceEntry } from './types.js';

export function buildSystemPrompt(input: {
  profile?: AgentProfile;
  evidenceRefs: EvidenceEntry[];
}): string | undefined {
  const parts: string[] = [];
  if (input.profile) {
    const p = input.profile;
    parts.push(
      `你是 ${p.name},${p.role}。性格:${p.personality}。擅长:${p.expertise.join('、')}。`,
    );
  }
  if (input.evidenceRefs.length > 0) {
    const lines = input.evidenceRefs.map(
      (e) => `- [${e.kind}] ${e.title}: ${e.content}`,
    );
    parts.push(`团队记忆:\n${lines.join('\n')}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
```

`packages/shared/src/index.ts`(追加):

```ts
export { buildSystemPrompt } from './system-prompt.js';
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 4 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(shared): buildSystemPrompt 身份与记忆拼装"
```

---

### Task 3: ProfileStore / EvidenceStore 端口 + 内存实现

**Files:**
- Modify: `packages/api/src/stores/ports.ts`
- Modify: `packages/api/src/stores/memory.ts`
- Modify: `packages/api/src/stores/factories.ts`
- Modify: `packages/api/test/stores-memory.test.ts`

**Interfaces:**
- Consumes: `AgentProfile`、`EvidenceEntry`、`generateEvidenceId`(Task 1)
- Produces:
  - `ProfileStore`: `create(profile: Omit<AgentProfile,'createdAt'>): Promise<AgentProfile>`、`get(agentId): Promise<AgentProfile | null>`、`list(): Promise<AgentProfile[]>`
  - `EvidenceStore`: `createDraft({threadId, kind, title, content}): Promise<EvidenceEntry>`、`confirm(id): Promise<EvidenceEntry | null>`(非 draft 返回 null)、`get(id): Promise<EvidenceEntry | null>`、`list(threadId?): Promise<EvidenceEntry[]>`
  - `createMemoryStores()` 返回值扩展为 `{ threads, messages, profiles, evidence }`

- [ ] **Step 1: 写失败测试(追加到 stores-memory.test.ts)**

`packages/api/test/stores-memory.test.ts`(追加 describe):

```ts
describe('内存 Profile/Evidence 存储', () => {
  it('profile 创建/读取/列表', async () => {
    const { profiles } = createMemoryStores();
    const created = await profiles.create({
      agentId: 'claude', name: '墨墨', personality: 'x', role: '写手', expertise: ['TS'],
    });
    expect(created.name).toBe('墨墨');
    expect(created.createdAt).toBeTruthy();
    expect(await profiles.get('claude')).toEqual(created);
    expect(await profiles.get('不存在')).toBeNull();
    expect((await profiles.list()).length).toBe(1);
  });

  it('draft 创建后 confirm 转正;重复 confirm 返回 null', async () => {
    const { evidence } = createMemoryStores();
    const draft = await evidence.createDraft({
      threadId: 't1', kind: 'fact', title: '标题', content: '内容',
    });
    expect(draft.id).toMatch(/^ev_[a-f0-9]{8}$/);
    expect(draft.status).toBe('draft');

    const confirmed = await evidence.confirm(draft.id);
    expect(confirmed?.status).toBe('confirmed');
    expect(await evidence.confirm(draft.id)).toBeNull();
    expect(await evidence.confirm('ev_00000000')).toBeNull();
  });

  it('list 可按线程过滤', async () => {
    const { evidence } = createMemoryStores();
    await evidence.createDraft({ threadId: 't1', kind: 'fact', title: 'a', content: 'a' });
    await evidence.createDraft({ threadId: 't2', kind: 'lesson', title: 'b', content: 'b' });
    expect((await evidence.list('t1')).length).toBe(1);
    expect((await evidence.list()).length).toBe(2);
    expect((await evidence.get('不存在的id'))).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/api exec vitest run test/stores-memory.test.ts`
Expected: FAIL,内存 store 无 profiles/evidence。

- [ ] **Step 3: 实现**

`packages/api/src/stores/ports.ts`(追加):

```ts
import type { AgentId, AgentProfile, EvidenceEntry, EvidenceKind, Message, Thread } from '@meowbase/shared';

export interface ProfileStore {
  create(profile: Omit<AgentProfile, 'createdAt'>): Promise<AgentProfile>;
  get(agentId: AgentId): Promise<AgentProfile | null>;
  list(): Promise<AgentProfile[]>;
}

export interface EvidenceStore {
  createDraft(input: {
    threadId: string;
    kind: EvidenceKind;
    title: string;
    content: string;
  }): Promise<EvidenceEntry>;
  confirm(id: string): Promise<EvidenceEntry | null>;
  get(id: string): Promise<EvidenceEntry | null>;
  list(threadId?: string): Promise<EvidenceEntry[]>;
}
```

(文件顶部 import 需合并 `AgentProfile`、`EvidenceEntry`、`EvidenceKind`)

`packages/api/src/stores/memory.ts`(追加):

```ts
import { generateEvidenceId } from '@meowbase/shared';
import type { AgentProfile, EvidenceEntry } from '@meowbase/shared';
import type { EvidenceStore, ProfileStore } from './ports.js';

export class InMemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, AgentProfile>();

  async create(profile: Omit<AgentProfile, 'createdAt'>): Promise<AgentProfile> {
    const record: AgentProfile = { ...profile, createdAt: new Date().toISOString() };
    this.profiles.set(record.agentId, record);
    return record;
  }

  async get(agentId: string): Promise<AgentProfile | null> {
    return this.profiles.get(agentId) ?? null;
  }

  async list(): Promise<AgentProfile[]> {
    return [...this.profiles.values()];
  }
}

export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly entries = new Map<string, EvidenceEntry>();

  async createDraft(input: {
    threadId: string;
    kind: EvidenceEntry['kind'];
    title: string;
    content: string;
  }): Promise<EvidenceEntry> {
    const entry: EvidenceEntry = {
      id: generateEvidenceId(),
      threadId: input.threadId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  async confirm(id: string): Promise<EvidenceEntry | null> {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'draft') return null;
    const updated: EvidenceEntry = { ...entry, status: 'confirmed' };
    this.entries.set(id, updated);
    return updated;
  }

  async get(id: string): Promise<EvidenceEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async list(threadId?: string): Promise<EvidenceEntry[]> {
    const all = [...this.entries.values()];
    return threadId ? all.filter((e) => e.threadId === threadId) : all;
  }
}
```

`packages/api/src/stores/factories.ts`(改造):

```ts
import { Redis } from 'ioredis';
import type { EvidenceStore, MessageStore, ProfileStore, ThreadStore } from './ports.js';
import {
  InMemoryEvidenceStore,
  InMemoryMessageStore,
  InMemoryProfileStore,
  InMemoryThreadStore,
} from './memory.js';
import { RedisEvidenceStore, RedisMessageStore, RedisProfileStore, RedisThreadStore } from './redis.js';

export function createMemoryStores(): {
  threads: ThreadStore;
  messages: MessageStore;
  profiles: ProfileStore;
  evidence: EvidenceStore;
} {
  return {
    threads: new InMemoryThreadStore(),
    messages: new InMemoryMessageStore(),
    profiles: new InMemoryProfileStore(),
    evidence: new InMemoryEvidenceStore(),
  };
}

export function createThreadStore(redis: Redis): ThreadStore {
  return new RedisThreadStore(redis);
}

export function createMessageStore(redis: Redis): MessageStore {
  return new RedisMessageStore(redis);
}

export function createProfileStore(redis: Redis): ProfileStore {
  return new RedisProfileStore(redis);
}

export function createEvidenceStore(redis: Redis): EvidenceStore {
  return new RedisEvidenceStore(redis);
}
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令(注意:factories 引用了尚不存在的 `RedisProfileStore`/`RedisEvidenceStore`,会编译失败——先建 Task 4 的 Redis 实现再跑,或先跳过 Step 4 直接进 Task 4)
Expected: 内存用例 3 个 PASS(需 Redis 类已存在,若报错先完成 Task 4 Step 3 再回来跑)

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): Profile/Evidence 端口 + 内存实现"
```

---

### Task 4: Redis 实现 + 种子 Profile + ensureSeededProfiles

**Files:**
- Modify: `packages/api/src/stores/redis.ts`(追加两个类)
- Create: `packages/api/src/stores/seeds.ts`
- Modify: `packages/api/test/redis-stores.test.ts`(追加用例)
- Create: `packages/api/test/seeds.test.ts`

**Interfaces:**
- Consumes: ports(Task 3)
- Produces: `SEED_PROFILES: Omit<AgentProfile,'createdAt'>[]`(墨墨/闪闪/团团)、`ensureSeededProfiles(store: ProfileStore): Promise<void>`(幂等)

- [ ] **Step 1: 写失败测试**

`packages/api/test/seeds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { ensureSeededProfiles, SEED_PROFILES } from '../src/stores/seeds.js';

describe('ensureSeededProfiles', () => {
  it('种子写入后幂等', async () => {
    const { profiles } = createMemoryStores();
    await ensureSeededProfiles(profiles);
    await ensureSeededProfiles(profiles);
    const list = await profiles.list();
    expect(list.length).toBe(SEED_PROFILES.length);
    expect(list.map((p) => p.name)).toEqual(['墨墨', '闪闪', '团团']);
  });
});
```

`packages/api/test/redis-stores.test.ts`(追加 describe):

```ts
describe('Redis Profile/Evidence 存储', () => {
  it('profile 读写 + 种子幂等', async () => {
    if (!redis) return;
    const profiles = createProfileStore(redis);
    await ensureSeededProfiles(profiles);
    await ensureSeededProfiles(profiles);
    expect((await profiles.list()).length).toBe(3);
    expect((await profiles.get('claude'))?.name).toBe('墨墨');
  });

  it('evidence draft → confirm', async () => {
    if (!redis) return;
    const evidence = createEvidenceStore(redis);
    const draft = await evidence.createDraft({ threadId: 't', kind: 'fact', title: 'x', content: 'y' });
    const confirmed = await evidence.confirm(draft.id);
    expect(confirmed?.status).toBe('confirmed');
    expect((await evidence.list('t')).length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @meowbase/api exec vitest run test/seeds.test.ts test/redis-stores.test.ts`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现**

`packages/api/src/stores/redis.ts`(追加):

```ts
import type { AgentProfile, EvidenceEntry } from '@meowbase/shared';
import { generateEvidenceId } from '@meowbase/shared';
import type { EvidenceStore, ProfileStore } from './ports.js';

function profileKey(agentId: string): string {
  return `profile:${agentId}`;
}

function evidenceKey(id: string): string {
  return `evidence:${id}`;
}

export class RedisProfileStore implements ProfileStore {
  constructor(private readonly redis: Redis) {}

  async create(profile: Omit<AgentProfile, 'createdAt'>): Promise<AgentProfile> {
    const record: AgentProfile = { ...profile, createdAt: new Date().toISOString() };
    await this.redis
      .multi()
      .hset(profileKey(record.agentId), {
        agentId: record.agentId,
        name: record.name,
        personality: record.personality,
        role: record.role,
        expertise: JSON.stringify(record.expertise),
        createdAt: record.createdAt,
      })
      .sadd('profile:index', record.agentId)
      .exec();
    return record;
  }

  private async hydrate(agentId: string): Promise<AgentProfile | null> {
    const raw = await this.redis.hgetall(profileKey(agentId));
    if (!raw.agentId) return null;
    return {
      agentId: raw.agentId,
      name: raw.name ?? '',
      personality: raw.personality ?? '',
      role: raw.role ?? '',
      expertise: JSON.parse(raw.expertise ?? '[]') as string[],
      createdAt: raw.createdAt ?? '',
    };
  }

  async get(agentId: string): Promise<AgentProfile | null> {
    return this.hydrate(agentId);
  }

  async list(): Promise<AgentProfile[]> {
    const ids = await this.redis.smembers('profile:index');
    const profiles: AgentProfile[] = [];
    for (const id of ids) {
      const profile = await this.hydrate(id);
      if (profile) profiles.push(profile);
    }
    return profiles;
  }
}

export class RedisEvidenceStore implements EvidenceStore {
  constructor(private readonly redis: Redis) {}

  private async hydrate(id: string): Promise<EvidenceEntry | null> {
    const raw = await this.redis.hgetall(evidenceKey(id));
    if (!raw.id) return null;
    return {
      id: raw.id,
      threadId: raw.threadId ?? '',
      kind: (raw.kind as EvidenceEntry['kind']) ?? 'fact',
      title: raw.title ?? '',
      content: raw.content ?? '',
      status: (raw.status as EvidenceEntry['status']) ?? 'draft',
      createdAt: raw.createdAt ?? '',
    };
  }

  async createDraft(input: {
    threadId: string;
    kind: EvidenceEntry['kind'];
    title: string;
    content: string;
  }): Promise<EvidenceEntry> {
    const entry: EvidenceEntry = {
      id: generateEvidenceId(),
      threadId: input.threadId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    await this.redis
      .multi()
      .hset(evidenceKey(entry.id), {
        id: entry.id,
        threadId: entry.threadId,
        kind: entry.kind,
        title: entry.title,
        content: entry.content,
        status: entry.status,
        createdAt: entry.createdAt,
      })
      .sadd('evidence:index', entry.id)
      .exec();
    return entry;
  }

  async confirm(id: string): Promise<EvidenceEntry | null> {
    const entry = await this.hydrate(id);
    if (!entry || entry.status !== 'draft') return null;
    await this.redis.hset(evidenceKey(id), 'status', 'confirmed');
    return this.hydrate(id);
  }

  async get(id: string): Promise<EvidenceEntry | null> {
    return this.hydrate(id);
  }

  async list(threadId?: string): Promise<EvidenceEntry[]> {
    const ids = await this.redis.smembers('evidence:index');
    const entries: EvidenceEntry[] = [];
    for (const id of ids) {
      const entry = await this.hydrate(id);
      if (entry && (!threadId || entry.threadId === threadId)) entries.push(entry);
    }
    return entries;
  }
}
```

`packages/api/src/stores/seeds.ts`:

```ts
import type { AgentProfile } from '@meowbase/shared';
import type { ProfileStore } from './ports.js';

export const SEED_PROFILES: Omit<AgentProfile, 'createdAt'>[] = [
  {
    agentId: 'claude',
    name: '墨墨',
    personality: '沉稳细致,爱写注释,重视代码可读性',
    role: '主力写手',
    expertise: ['架构设计', 'TypeScript', '代码实现'],
  },
  {
    agentId: 'gemini',
    name: '闪闪',
    personality: '活泼,点子多,语速快',
    role: '审查官',
    expertise: ['代码审查', '方案评审', '头脑风暴'],
  },
  {
    agentId: 'opencode',
    name: '团团',
    personality: '圆润可靠,话不多,执行力强',
    role: '执行者',
    expertise: ['多模型兼容', '工具调用', '脚本'],
  },
];

export async function ensureSeededProfiles(store: ProfileStore): Promise<void> {
  for (const seed of SEED_PROFILES) {
    const existing = await store.get(seed.agentId);
    if (!existing) await store.create(seed);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令(现在 Task 3 的内存用例也可以一并跑通)
Expected: seeds 1 个 + redis 2 个(Redis 可用时)全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): Redis Profile/Evidence 存储 + 种子 profile"
```

---

### Task 5: executeTurn 扩展(消息协议 + 身份/记忆注入)

**Files:**
- Modify: `packages/api/src/router/execute-turn.ts`
- Modify: `packages/api/test/execute-turn.test.ts`(追加用例)

**Interfaces:**
- Consumes: `parseConfirmCommand`/`parseLearnCommand`/`parseEvidenceRefs`/`buildSystemPrompt`(Task 1-2)、ProfileStore/EvidenceStore(Task 3)
- Produces: `TurnContext.stores` 扩展为 `{ threads, messages, profiles, evidence }`
- 行为:① `#confirm` 命中 → 确认/回执,不调 agent;② `#learn` 命中且 assistant completed → 创建 draft + 建议消息;③ `#ev_` 引用 → 注入 systemPrompt;④ profile 仅新会话注入

- [ ] **Step 1: 写失败测试(追加到 execute-turn.test.ts)**

`packages/api/test/execute-turn.test.ts`(追加 describe):

```ts
describe('executeTurn 消息协议与注入', () => {
  it('#confirm 确认 draft:回执且不调 agent', async () => {
    const stores = createMemoryStores();
    let agentCalled = false;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          agentCalled = true;
          return { sessionId: '', content: '', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const draft = await stores.evidence.createDraft({
      threadId: thread.id, kind: 'fact', title: '好结论', content: '内容',
    });
    const final = await executeTurn({
      threadId: thread.id,
      content: `#confirm ${draft.id}`,
      context: { stores, registry },
    });
    expect(agentCalled).toBe(false);
    expect(final.role).toBe('system');
    expect(final.content).toContain('✅ 已沉淀:好结论');
    expect((await stores.evidence.get(draft.id))?.status).toBe('confirmed');
  });

  it('#confirm 无效 id:回执警告', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', 'x')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const final = await executeTurn({
      threadId: thread.id, content: '#confirm ev_00000000', context: { stores, registry },
    });
    expect(final.role).toBe('system');
    expect(final.content).toContain('⚠️');
  });

  it('#learn 完成轮生成 draft + 建议消息', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([stubAgent('claude', '这是重要结论')]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '#learn 团队约定', context: { stores, registry },
    });
    const drafts = await stores.evidence.list(thread.id);
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.title).toBe('团队约定');
    expect(drafts[0]?.content).toBe('这是重要结论');
    expect(drafts[0]?.status).toBe('draft');
    const messages = await stores.messages.list(thread.id);
    const suggestion = messages.find((m) => m.role === 'system');
    expect(suggestion?.content).toContain('💡 建议沉淀为证据:「团队约定」');
    expect(suggestion?.content).toContain(`#confirm ${drafts[0]?.id}`);
  });

  it('#ev_ 引用注入 systemPrompt', async () => {
    const stores = createMemoryStores();
    let receivedPrompt: string | undefined;
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          receivedPrompt = input.systemPrompt;
          return { sessionId: 'sess-new', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    const entry = await stores.evidence.createDraft({
      threadId: thread.id, kind: 'fact', title: '关键事实', content: '事实内容',
    });
    await stores.evidence.confirm(entry.id);
    await executeTurn({
      threadId: thread.id, content: `用 #ev_${entry.id.slice(3)}`, context: { stores, registry },
    });
    expect(receivedPrompt).toContain('团队记忆');
    expect(receivedPrompt).toContain('关键事实: 事实内容');
  });

  it('新会话注入 profile;resume 不注入', async () => {
    const stores = createMemoryStores();
    const prompts: (string | undefined)[] = [];
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn(input) {
          prompts.push(input.systemPrompt);
          return { sessionId: 'sess-1', content: 'ok', status: 'completed' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await stores.profiles.create({
      agentId: 'claude', name: '墨墨', personality: '沉稳', role: '写手', expertise: ['TS'],
    });
    // 第一轮:新会话,应注入
    await executeTurn({ threadId: thread.id, content: 'hi', context: { stores, registry } });
    expect(prompts[0]).toContain('你是 墨墨');
    // 第二轮:已有 session,不注入
    await executeTurn({ threadId: thread.id, content: 'hi again', context: { stores, registry } });
    expect(prompts[1]).toBeUndefined();
  });

  it('#learn 失败轮不生成 draft', async () => {
    const stores = createMemoryStores();
    const registry = createAgentRegistry([
      {
        agentId: 'claude',
        async runTurn() {
          return { sessionId: '', content: '', status: 'failed', error: 'boom' };
        },
      },
    ]);
    const thread = await stores.threads.create({ title: 't', primaryAgentId: 'claude' });
    await executeTurn({
      threadId: thread.id, content: '#learn 不该沉淀', context: { stores, registry },
    });
    expect((await stores.evidence.list(thread.id)).length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/api exec vitest run test/execute-turn.test.ts`
Expected: 新用例 FAIL(TurnContext 缺 profiles/evidence)。

- [ ] **Step 3: 实现**

`packages/api/src/router/execute-turn.ts`(整体替换):

```ts
import { buildSystemPrompt, parseConfirmCommand, parseEvidenceRefs, parseLearnCommand, resolveTargetAgent } from '@meowbase/shared';
import type { AgentId, EvidenceEntry, Message } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type { EvidenceStore, MessageStore, ProfileStore, ThreadStore } from '../stores/ports.js';

export interface TurnContext {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
  };
  registry: AgentRegistry;
  onIncrement?: (threadId: string, messageId: string, delta: string) => void;
}

export async function executeTurn(input: {
  threadId: string;
  content: string;
  context: TurnContext;
}): Promise<Message> {
  const { threadId, content, context } = input;

  const thread = await context.stores.threads.get(threadId);
  if (!thread) throw new Error(`线程不存在: ${threadId}`);

  await context.stores.messages.append({
    threadId,
    role: 'user',
    content,
    status: 'completed',
  });

  // #confirm 分支:纯系统操作,不路由给 agent
  const confirm = parseConfirmCommand(content);
  if (confirm) {
    const entry = await context.stores.evidence.confirm(confirm.id);
    const reply = entry
      ? `✅ 已沉淀:${entry.title}`
      : `⚠️ 找不到可确认的证据:${confirm.id}`;
    return context.stores.messages.append({
      threadId,
      role: 'system',
      content: reply,
      status: 'completed',
    });
  }

  const targetAgentId: AgentId = resolveTargetAgent(content, thread.primaryAgentId);
  const service = context.registry.get(targetAgentId);
  if (!service) throw new Error(`没有可用的 agent: ${targetAgentId}`);

  const learn = parseLearnCommand(content);
  const refIds = parseEvidenceRefs(content);

  // systemPrompt 组装:引用证据任意轮注入;profile 仅新会话注入
  const refs: EvidenceEntry[] = [];
  for (const id of refIds) {
    const entry = await context.stores.evidence.get(id);
    if (entry?.status === 'confirmed') refs.push(entry);
  }
  const isNewSession = !thread.sessions[targetAgentId];
  const profile = isNewSession
    ? await context.stores.profiles.get(targetAgentId)
    : undefined;
  const systemPrompt = buildSystemPrompt({ profile, evidenceRefs: refs });

  const assistantMessage = await context.stores.messages.append({
    threadId,
    role: 'assistant',
    agentId: targetAgentId,
    content: '',
    status: 'streaming',
  });

  let accumulated = '';
  const output = await service.runTurn({
    prompt: content,
    systemPrompt,
    sessionId: thread.sessions[targetAgentId],
    workdir: thread.workdir,
    onIncrement: (delta) => {
      accumulated += delta;
      void context.stores.messages.patch(threadId, assistantMessage.id, {
        content: accumulated,
      });
      context.onIncrement?.(threadId, assistantMessage.id, delta);
    },
  });

  if (output.sessionId && thread.sessions[targetAgentId] !== output.sessionId) {
    await context.stores.threads.setSession(threadId, targetAgentId, output.sessionId);
  }

  // #learn 沉淀:仅 completed 时生成 draft + 建议消息
  if (learn && output.status === 'completed' && output.content) {
    const draft = await context.stores.evidence.createDraft({
      threadId,
      kind: 'fact',
      title: learn.title,
      content: output.content,
    });
    await context.stores.messages.append({
      threadId,
      role: 'system',
      content: `💡 建议沉淀为证据:「${draft.title}」\n回复 #confirm ${draft.id} 确认`,
      status: 'completed',
    });
  }

  return context.stores.messages.patch(threadId, assistantMessage.id, {
    content: output.content || accumulated,
    status: output.status,
    usage: output.usage,
    error: output.error,
    sessionId: output.sessionId || undefined,
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 原有 6 个 + 新增 6 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): executeTurn 消息协议(#confirm/#learn/#ev_)与身份注入"
```

---

### Task 6: HTTP API + 启动种子

**Files:**
- Modify: `packages/api/src/http/server.ts`(两条只读路由 + ApiDeps 扩展)
- Modify: `packages/api/src/index.ts`(启动时 ensureSeededProfiles)
- Modify: `packages/api/test/http-integration.test.ts`(追加用例)

**Interfaces:**
- Produces: `GET /api/profiles`、`GET /api/evidence?threadId=`

- [ ] **Step 1: 写失败测试(追加到 http-integration.test.ts)**

```ts
it('GET /api/profiles 与 /api/evidence', async () => {
  const createRes = await fetch(`${baseUrl}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'm2' }),
  });
  const thread = (await createRes.json()) as { id: string };

  // 通过消息协议创建 draft
  await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '#learn 集成测试结论' }),
  });

  const profilesRes = await fetch(`${baseUrl}/api/profiles`);
  const profiles = (await profilesRes.json()) as { name: string }[];
  expect(profiles.map((p) => p.name)).toEqual(['墨墨', '闪闪', '团团']);

  const evidenceRes = await fetch(`${baseUrl}/api/evidence?threadId=${thread.id}`);
  const evidence = (await evidenceRes.json()) as { status: string; title: string }[];
  expect(evidence.length).toBe(1);
  expect(evidence[0]?.status).toBe('draft');
});
```

(集成测试的 stores 用 `createMemoryStores()`,profiles 默认无种子——在 beforeAll 里 buildServer 前先 `await ensureSeededProfiles(stores.profiles)`,测试顶部 import `ensureSeededProfiles`。)

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @meowbase/api exec vitest run test/http-integration.test.ts`
Expected: FAIL,路由不存在 / profiles 为空。

- [ ] **Step 3: 实现**

`packages/api/src/http/server.ts`(ApiDeps 与路由):

```ts
import type { EvidenceStore, MessageStore, ProfileStore, ThreadStore } from '../stores/ports.js';

export interface ApiDeps {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
  };
  registry: AgentRegistry;
  workdirBase: string;
}
```

路由(加在 `/api/threads` 之后):

```ts
app.get('/api/profiles', async () => deps.stores.profiles.list());

app.get('/api/evidence', async (request) => {
  const { threadId } = request.query as { threadId?: string };
  return deps.stores.evidence.list(threadId);
});
```

`packages/api/src/index.ts`(启动时种子):

```ts
import { ensureSeededProfiles } from './stores/seeds.js';
import { createEvidenceStore, createMessageStore, createProfileStore, createThreadStore } from './stores/factories.js';

// 在 buildServer 前:
const stores = {
  threads: createThreadStore(redis),
  messages: createMessageStore(redis),
  profiles: createProfileStore(redis),
  evidence: createEvidenceStore(redis),
};
await ensureSeededProfiles(stores.profiles);

const app = await buildServer({ stores, registry: ..., workdirBase: config.workdirBase });
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 原有 3 个 + 新增 1 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): profiles/evidence 只读 API + 启动种子"
```

---

### Task 7: ClaudeAdapter 注入参数断言

**Files:**
- Create: `packages/api/test/fixtures/fake-claude-args.mjs`
- Modify: `packages/api/test/claude-adapter.test.ts`(追加用例)

**Interfaces:**
- 验证:systemPrompt 传入时 args 含 `--append-system-prompt <prompt>`;resume 时含 `--resume <sessionId>`

- [ ] **Step 1: 写失败测试 + 记录 args 的 fake**

`packages/api/test/fixtures/fake-claude-args.mjs`:

```js
#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(
  process.env.RECORD_ARGS_FILE ?? '/tmp/claude-args.txt',
  JSON.stringify(process.argv.slice(2)),
);
process.stdout.write(
  '{"type":"system","subtype":"init","session_id":"sess-args"}\n' +
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]},"session_id":"sess-args"}\n' +
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"sess-args","total_cost_usd":0}\n',
);
```

`packages/api/test/claude-adapter.test.ts`(追加):

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARGS_BIN = join(import.meta.dirname, 'fixtures', 'fake-claude-args.mjs');

describe('ClaudeAdapter 参数', () => {
  it('systemPrompt → --append-system-prompt;sessionId → --resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-args-'));
    const recordFile = join(dir, 'args.json');
    const adapter = new ClaudeAdapter({ bin: ARGS_BIN });
    await adapter.runTurn({
      prompt: 'hi',
      workdir: '/tmp',
      sessionId: 'sess-old',
      systemPrompt: '你是 墨墨',
    });
    const args = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    const promptIndex = args.indexOf('--append-system-prompt');
    expect(promptIndex).toBeGreaterThan(-1);
    expect(args[promptIndex + 1]).toBe('你是 墨墨');
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-old');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run:

```bash
cd /Users/xuzishuo/code/meowbase && chmod +x packages/api/test/fixtures/fake-claude-args.mjs && pnpm --filter @meowbase/api exec vitest run test/claude-adapter.test.ts
```

Expected: 新用例 FAIL(fixture 不存在)。

- [ ] **Step 3: 实现**

无源码改动——此任务验证已有行为。若测试意外失败(例如参数顺序问题),修正 `packages/api/src/providers/claude.ts` 的 args 拼装并保持测试通过。

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 原有 2 个 + 新增 1 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "test(api): 断言 --append-system-prompt 与 --resume 参数"
```

---

### Task 8: 收尾——全量测试、冒烟、README

**Files:**
- Modify: `README.md`(补充消息协议说明)
- Modify: `scripts/smoke.ts`(冒烟消息改为带 `#learn`,验证协议链路)

**Interfaces:**
- 验收:`pnpm test` 全绿;fake 冒烟通过

- [ ] **Step 1: 更新冒烟脚本**

`scripts/smoke.ts` 中的消息内容改为:

```ts
body: JSON.stringify({ content: '@claude 请用一句话介绍你自己\n#learn 冒烟测试结论' }),
```

并在消息响应后追加断言:`#learn` 应生成 draft(通过 `GET /api/evidence?threadId=` 校验 length ≥ 1)。冒烟输出增加:

```ts
const evidenceRes = await fetch(`${baseUrl}/api/evidence?threadId=${thread.id}`);
const evidence = (await evidenceRes.json()) as { title: string }[];
console.log('evidence drafts:', evidence.length);
if (evidence.length < 1) throw new Error('冒烟失败: 未生成证据 draft');
```

- [ ] **Step 2: 全量验证**

Run:

```bash
cd /Users/xuzishuo/code/meowbase && pnpm test && pnpm -r build && CLAUDE_BIN="$PWD/packages/api/test/fixtures/fake-claude.mjs" pnpm smoke
```

Expected: shared 与 api 全部用例 PASS(总数 ≥ 47),构建通过,冒烟通过且打印 `evidence drafts: 1`。

- [ ] **Step 3: 更新 README**

`README.md` 追加:

```markdown
## 消息协议(M2)

- `#learn <标题>` —— 请求沉淀本轮回复为证据,系统会给出确认提示
- `#confirm ev_xxxxxxxx` —— 确认沉淀
- `#ev_xxxxxxxx` —— 在消息中引用历史证据,注入 agent 上下文
- 三个 agent 有内置身份(墨墨/闪闪/团团),新会话自动注入
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: M2 冒烟扩展 + README 消息协议"
```

---

## M2 完成后的验证清单

```bash
cd /Users/xuzishuo/code/meowbase
pnpm test          # 全绿(≥47 用例)
pnpm -r build      # 构建通过
CLAUDE_BIN=.../fake-claude.mjs pnpm smoke   # 冒烟通过,evidence drafts ≥ 1
```

验收标准(来自 M2 spec §12):测试全绿且新增用例 ≥ 15;重启后 profile/证据仍在(Redis);身份注入生效(fake 冒烟可观察)。真实 claude 验证为可选项(用户付费 key,按需执行)。
