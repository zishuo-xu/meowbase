export const DEFAULT_LISTEN_HOST = '127.0.0.1';
export const DEFAULT_WEB_PORT = 3300;

/** 生产入口默认只听本机。`API_SERVER_HOST=0.0.0.0` 才开 LAN。 */
export function resolveListenHost(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const raw = env.API_SERVER_HOST?.trim();
  return raw || DEFAULT_LISTEN_HOST;
}

/**
 * 浏览器来源表。`localhost` 和 `127.0.0.1` 是两个不同的 origin,都要放。
 * `NEXT_PUBLIC_API_URL` 指到别处时,把那个主机的 web 端口也加进来。
 */
export function resolveAllowedOrigins(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string[] {
  const webPort = parseWebPort(env.WEB_PORT);
  const origins = [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];
  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) return origins;
  try {
    const url = new URL(apiUrl);
    const extra = `${url.protocol}//${url.hostname}:${webPort}`;
    if (!origins.includes(extra)) origins.push(extra);
  } catch {
    // 指歪了就不加,别把整张表弄坏
  }
  return origins;
}

function parseWebPort(raw: string | undefined): number {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : DEFAULT_WEB_PORT;
}

/**
 * 不带 Origin(curl / e2e / smoke / Node fetch)放行;
 * 带了就必须在来源表里。浏览器跨域一定会带 Origin,省掉的不能一律拒。
 */
export function isAllowedRequestOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin == null || origin === '') return true;
  return allowed.includes(origin);
}
