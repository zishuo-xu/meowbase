import type { AgentId } from './types.js';

/** @mention 词元:英文 id 或连续中文名 */
export const MENTION_TOKEN_RE = /@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)/g;

export interface MentionCatalog {
  aliases: Record<string, AgentId>;
  names: Record<AgentId, string>;
}

export interface TeamMember {
  agentId: AgentId;
  name: string;
  role: string;
  /** 做完本职后交接给谁;平台选审查官也读这个 */
  handoffTo?: AgentId;
  /** 声明审哪类风险面的改动;缺失 = 只参与 default 面选官 */
  reviewRisk?: readonly ('safety' | 'contract')[];
  /** 何时必须交接;`{to}` 替换成对手 @名 */
  handoff?: readonly string[];
  /** 怎样算做完;`{to}` 替换成对手 @名 */
  doneWhen?: readonly string[];
}

export const DEFAULT_ROSTER: readonly TeamMember[] = [
  {
    agentId: 'claude',
    name: '墨墨',
    role: '主架构师',
    handoffTo: 'gemini',
    handoff: [
      '你写完或改完代码后,另起一行 {to} 请审查(不要自己审自己)。',
      '下一步明显属于别人的职责(审查/脚本落地)时,做完自己这段就交出去。',
      '你缺工具、缺第二视角、或遇到做不了的部分时。',
    ],
    doneWhen: [
      '对照任务:用户要的已经落在沙箱里,缺的直说并补上或交出去。',
      '改了代码就自检:本轮命令和结果写进回复;跑不了写「跑不了:原因」。没证据不要声称完成,但可以交 {to}。',
      '需要审查时已经行首 {to} 写了任务,不要问人要不要交。',
    ],
  },
  {
    agentId: 'gemini',
    name: '闪闪',
    role: '审查官',
    handoffTo: 'claude',
    reviewRisk: ['safety', 'contract'],
    handoff: [
      '审查结束后写出结论,必须写明「通过」或「需修改」;需修改时列出要点,不要问人,不要再 @ 写手。需修改由平台打回。',
      '你自己写完代码后交 {to} 看一眼,不要自己审自己。',
    ],
    doneWhen: [
      '对照任务和 diff 下判断,不要空泛夸奖。',
      '结论单独写明「通过」或「需修改」;没看到或没跑出命令+结果不能写通过。需修改只列写手能改的要点。',
      '写出结论即停,不要问人下一步怎么办,不要再 @ 写手或第三人。需修改由平台打回。',
    ],
  },
  {
    agentId: 'opencode',
    name: '团团',
    role: '执行者',
    handoffTo: 'gemini',
    handoff: [
      '脚本或落地做完后,另起一行 {to} 请审查(不要自己审自己)。',
      '你缺第二视角、或遇到做不了的部分时。',
    ],
    doneWhen: [
      '脚本或落地已在沙箱里跑过,回复里带命令和结果;跑不了写「跑不了:原因」。',
      '做完另起一行 {to} 请审查,不要问人要不要交。',
    ],
  },
];

function aliasKey(token: string): string {
  return /^[a-zA-Z]/.test(token) ? token.toLowerCase() : token;
}

export function buildMentionCatalog(
  members: readonly {
    agentId: AgentId;
    name: string;
    aliases?: readonly string[];
  }[] = [],
): MentionCatalog {
  const aliases: Record<string, AgentId> = {};
  const names = {} as Record<AgentId, string>;
  const add = (row: { agentId: AgentId; name: string; aliases?: readonly string[] }) => {
    names[row.agentId] = row.name;
    aliases[aliasKey(row.agentId)] = row.agentId;
    aliases[aliasKey(row.name)] = row.agentId;
    for (const extra of row.aliases ?? []) {
      const token = extra.replace(/^@/, '');
      if (token) aliases[aliasKey(token)] = row.agentId;
    }
  };
  for (const row of DEFAULT_ROSTER) add(row);
  for (const row of members) add(row);
  return { aliases, names };
}

export const DEFAULT_CATALOG = buildMentionCatalog();

export function resolveAlias(
  token: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId | undefined {
  return catalog.aliases[aliasKey(token)];
}

export function displayName(
  agentId: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): string {
  return catalog.names[agentId] ?? agentId;
}
