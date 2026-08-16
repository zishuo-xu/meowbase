import type { ModelProtocol } from '../config.js';

export function normalizeGatewayUrl(protocol: ModelProtocol, raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (protocol === 'anthropic') return url.replace(/\/v1$/i, '');
  if (protocol === 'openai' && !/\/v1$/i.test(url)) return `${url}/v1`;
  return url;
}

export function envForBaseUrl(
  protocol: ModelProtocol,
  baseUrl: string | undefined,
): Record<string, string> {
  const url = normalizeGatewayUrl(protocol, baseUrl ?? '');
  if (!url) return {};
  if (protocol === 'anthropic') return { ANTHROPIC_BASE_URL: url };
  if (protocol === 'openai') return { OPENAI_BASE_URL: url, OPENAI_API_BASE: url };
  return { GOOGLE_GEMINI_BASE_URL: url, GEMINI_API_BASE: url };
}

export function spawnEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  if (!extra || Object.keys(extra).length === 0) return process.env;
  return { ...process.env, ...extra };
}
