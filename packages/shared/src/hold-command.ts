/** 出现任一即拒,不再解析。`&&` / `||` 已被 `&` / `|` 覆盖。 */
const META_RE = /[;|`<>&\n\r]|\$\(/;

export type HoldCommandDenyReason = 'metachar' | 'not-allowlisted';

export type HoldCommandArgvResult =
  | { ok: true; argv: string[] }
  | { ok: false; reason: HoldCommandDenyReason };

/** 程序 + 允许的第一个参数形状。`*` 表示该位必须有、但内容不限。 */
export interface HoldCommandRule {
  program: string;
  args?: readonly (string | '*')[];
}

export const DEFAULT_HOLD_COMMAND_ALLOWLIST: readonly HoldCommandRule[] = [
  { program: 'npm', args: ['test'] },
  { program: 'npm', args: ['run', '*'] },
  { program: 'pnpm', args: ['test'] },
  { program: 'pnpm', args: ['build'] },
  { program: 'pnpm', args: ['typecheck'] },
  { program: 'tsc' },
  { program: 'pytest' },
  { program: 'go', args: ['test'] },
  { program: 'cargo', args: ['test'] },
  { program: 'git', args: ['status'] },
  { program: 'git', args: ['diff'] },
];

export const DEFAULT_HOLD_COMMAND_ENV_KEYS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USER',
  'LOGNAME',
] as const;

/** 先扫元字符;干净才按引号拆 argv。 */
export function parseHoldCommandArgv(command: string): HoldCommandArgvResult {
  if (META_RE.test(command)) return { ok: false, reason: 'metachar' };
  const argv = tokenizeArgv(command);
  if (!argv) return { ok: false, reason: 'not-allowlisted' };
  return { ok: true, argv };
}

function tokenizeArgv(command: string): string[] | null {
  const argv: string[] = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    while (i < n && (command[i] === ' ' || command[i] === '\t')) i += 1;
    if (i >= n) break;
    const quote = command[i] === '"' || command[i] === "'" ? command[i] : null;
    if (quote) {
      i += 1;
      let token = '';
      while (i < n && command[i] !== quote) {
        token += command[i];
        i += 1;
      }
      if (i >= n) return null;
      i += 1;
      argv.push(token);
      continue;
    }
    let token = '';
    while (i < n && command[i] !== ' ' && command[i] !== '\t') {
      token += command[i];
      i += 1;
    }
    argv.push(token);
  }
  return argv.length > 0 ? argv : null;
}

export function matchesHoldCommandAllowlist(
  argv: readonly string[],
  allowlist: readonly HoldCommandRule[] = DEFAULT_HOLD_COMMAND_ALLOWLIST,
): boolean {
  const program = argv[0];
  if (!program || program.includes('/') || program.includes('\\')) return false;
  return allowlist.some((rule) => {
    if (rule.program !== program) return false;
    const needed = rule.args ?? [];
    if (argv.length - 1 < needed.length) return false;
    return needed.every((part, index) => part === '*' || argv[index + 1] === part);
  });
}

export type AuthorizeHoldCommandResult =
  | { ok: true; argv: string[] }
  | { ok: false; reason: HoldCommandDenyReason };

export function authorizeHoldCommand(
  command: string,
  allowlist: readonly HoldCommandRule[] = DEFAULT_HOLD_COMMAND_ALLOWLIST,
): AuthorizeHoldCommandResult {
  const parsed = parseHoldCommandArgv(command);
  if (!parsed.ok) return parsed;
  if (!matchesHoldCommandAllowlist(parsed.argv, allowlist)) {
    return { ok: false, reason: 'not-allowlisted' };
  }
  return { ok: true, argv: parsed.argv };
}

export function formatDeniedHoldCommandNote(input: {
  command: string;
  reason: HoldCommandDenyReason;
}): string {
  const cmd = clipCommand(input.command.trim(), 80);
  const why =
    input.reason === 'metachar'
      ? '命令含分号、管道或重定向等 shell 元字符,平台不解析'
      : '不在白名单';
  return `⚠️ 球还在地上:平台没跑 \`${cmd}\` — ${why}。人可以自己跑。`;
}

export function pickHoldCommandEnv(
  source: NodeJS.ProcessEnv,
  extraKeys: readonly string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...DEFAULT_HOLD_COMMAND_ENV_KEYS, ...extraKeys]) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function clipCommand(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function parseHoldCommandAllowlist(raw: unknown): HoldCommandRule[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: HoldCommandRule[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null;
    const rec = row as Record<string, unknown>;
    const program = typeof rec.program === 'string' ? rec.program.trim() : '';
    if (!program) return null;
    const args = Array.isArray(rec.args)
      ? rec.args.map((item) => (item === '*' ? '*' : String(item)))
      : undefined;
    out.push(args ? { program, args } : { program });
  }
  return out;
}
