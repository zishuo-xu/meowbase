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

export function envForApiKey(
  protocol: ModelProtocol,
  apiKey: string | undefined,
): Record<string, string> {
  const key = (apiKey ?? '').trim();
  if (!key) return {};
  if (protocol === 'anthropic') return { ANTHROPIC_API_KEY: key };
  if (protocol === 'openai') return { OPENAI_API_KEY: key };
  return {
    GEMINI_API_KEY: key,
    GOOGLE_API_KEY: key,
    GOOGLE_GENAI_API_KEY: key,
  };
}

export function envForGateway(
  protocol: ModelProtocol,
  input: { baseUrl?: string; apiKey?: string },
): Record<string, string> {
  return {
    ...envForBaseUrl(protocol, input.baseUrl),
    ...envForApiKey(protocol, input.apiKey),
  };
}

export function spawnEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  if (!extra || Object.keys(extra).length === 0) return process.env;
  return { ...process.env, ...extra };
}
