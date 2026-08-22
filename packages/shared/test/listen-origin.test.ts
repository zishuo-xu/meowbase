import { describe, expect, it } from 'vitest';
import {
  isAllowedRequestOrigin,
  resolveAllowedOrigins,
  resolveListenHost,
} from '../src/listen-origin.js';

describe('resolveListenHost', () => {
  it('默认是 127.0.0.1', () => {
    expect(resolveListenHost({})).toBe('127.0.0.1');
    expect(resolveListenHost({ API_SERVER_HOST: '' })).toBe('127.0.0.1');
    expect(resolveListenHost({ API_SERVER_HOST: '   ' })).toBe('127.0.0.1');
  });

  it('显式开关能改回 0.0.0.0', () => {
    expect(resolveListenHost({ API_SERVER_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveListenHost({ API_SERVER_HOST: ' 0.0.0.0 ' })).toBe('0.0.0.0');
  });
});

describe('resolveAllowedOrigins / isAllowedRequestOrigin', () => {
  it('localhost 和 127.0.0.1 都放行,默认跟 3300', () => {
    const origins = resolveAllowedOrigins({});
    expect(origins).toEqual(['http://localhost:3300', 'http://127.0.0.1:3300']);
    expect(isAllowedRequestOrigin('http://localhost:3300', origins)).toBe(true);
    expect(isAllowedRequestOrigin('http://127.0.0.1:3300', origins)).toBe(true);
  });

  it('非法来源拒;不带 Origin 放行(curl / e2e / smoke)', () => {
    const origins = resolveAllowedOrigins({});
    expect(isAllowedRequestOrigin('http://evil.example', origins)).toBe(false);
    expect(isAllowedRequestOrigin('http://localhost:3200', origins)).toBe(false);
    expect(isAllowedRequestOrigin(undefined, origins)).toBe(true);
    expect(isAllowedRequestOrigin('', origins)).toBe(true);
  });

  it('NEXT_PUBLIC_API_URL 指到别处时来源表带上那个主机的 web 端口', () => {
    const origins = resolveAllowedOrigins({
      NEXT_PUBLIC_API_URL: 'http://192.168.1.8:3200',
    });
    expect(origins).toContain('http://localhost:3300');
    expect(origins).toContain('http://127.0.0.1:3300');
    expect(origins).toContain('http://192.168.1.8:3300');
    expect(isAllowedRequestOrigin('http://192.168.1.8:3300', origins)).toBe(true);
  });

  it('web 端口跟着 WEB_PORT 走', () => {
    const origins = resolveAllowedOrigins({ WEB_PORT: '4400' });
    expect(origins).toEqual(['http://localhost:4400', 'http://127.0.0.1:4400']);
  });
});
