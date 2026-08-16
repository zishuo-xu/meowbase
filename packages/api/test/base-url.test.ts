import { describe, expect, it } from 'vitest';
import { envForApiKey, envForBaseUrl, normalizeGatewayUrl } from '../src/providers/base-url.js';

describe('normalizeGatewayUrl', () => {
  it('Anthropic 去掉末尾 /v1', () => {
    expect(normalizeGatewayUrl('anthropic', 'https://api.moonshot.cn/anthropic/v1/')).toBe(
      'https://api.moonshot.cn/anthropic',
    );
  });

  it('OpenAI 没有 /v1 时补上', () => {
    expect(normalizeGatewayUrl('openai', 'https://api.moonshot.cn')).toBe('https://api.moonshot.cn/v1');
    expect(normalizeGatewayUrl('openai', 'https://api.moonshot.cn/v1')).toBe('https://api.moonshot.cn/v1');
  });

  it('Gemini 只去尾斜杠', () => {
    expect(normalizeGatewayUrl('gemini', 'https://generativelanguage.googleapis.com/')).toBe(
      'https://generativelanguage.googleapis.com',
    );
  });
});

describe('envForBaseUrl', () => {
  it('空 URL 不注入', () => {
    expect(envForBaseUrl('openai', undefined)).toEqual({});
    expect(envForBaseUrl('anthropic', '  ')).toEqual({});
  });

  it('按协议写环境变量', () => {
    expect(envForBaseUrl('anthropic', 'https://api.moonshot.cn/anthropic/v1')).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
    });
    expect(envForBaseUrl('openai', 'https://api.moonshot.cn')).toEqual({
      OPENAI_BASE_URL: 'https://api.moonshot.cn/v1',
      OPENAI_API_BASE: 'https://api.moonshot.cn/v1',
    });
    expect(envForBaseUrl('gemini', 'https://example.com/gemini')).toEqual({
      GOOGLE_GEMINI_BASE_URL: 'https://example.com/gemini',
      GEMINI_API_BASE: 'https://example.com/gemini',
    });
  });
});

describe('envForApiKey', () => {
  it('空密钥不注入', () => {
    expect(envForApiKey('openai', undefined)).toEqual({});
    expect(envForApiKey('anthropic', '  ')).toEqual({});
  });

  it('按协议写 API Key 环境变量', () => {
    expect(envForApiKey('anthropic', 'sk-ant')).toEqual({ ANTHROPIC_API_KEY: 'sk-ant' });
    expect(envForApiKey('openai', 'sk-openai')).toEqual({ OPENAI_API_KEY: 'sk-openai' });
    expect(envForApiKey('gemini', 'sk-gem')).toEqual({
      GEMINI_API_KEY: 'sk-gem',
      GOOGLE_API_KEY: 'sk-gem',
      GOOGLE_GENAI_API_KEY: 'sk-gem',
    });
  });
});
