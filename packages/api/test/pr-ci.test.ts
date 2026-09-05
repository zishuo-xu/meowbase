import { describe, expect, it } from 'vitest';
import {
  formatPrCiNote,
  formatPrCiWakeTask,
  parsePrChecksJson,
  selectUnseenPrChecks,
} from '../src/services/pr.js';

const CHECKS = JSON.stringify([
  { name: 'test', state: 'SUCCESS', link: 'https://ci.example/test' },
  { name: 'lint', state: 'FAILURE', link: 'https://ci.example/lint' },
  { name: 'build', state: 'PENDING', link: 'https://ci.example/build' },
  { name: 'typecheck', state: 'ERROR' },
]);

describe('parsePrChecksJson', () => {
  it('SUCCESS 绿,FAILURE/ERROR 红,PENDING 丢掉', () => {
    const items = parsePrChecksJson(CHECKS);
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.id)).toEqual(['test:SUCCESS', 'lint:FAILURE', 'typecheck:ERROR']);
    expect(items![0]).toMatchObject({ name: 'test', conclusion: 'green' });
    expect(items![1]).toMatchObject({ name: 'lint', conclusion: 'red' });
    expect(items![2]).toMatchObject({ name: 'typecheck', conclusion: 'red' });
  });

  it('不是 JSON 数组返回 null', () => {
    expect(parsePrChecksJson('not json')).toBeNull();
    expect(parsePrChecksJson('{}')).toBeNull();
  });
});

describe('selectUnseenPrChecks', () => {
  it('过滤已见 name:state', () => {
    const items = parsePrChecksJson(CHECKS)!;
    expect(selectUnseenPrChecks(items, ['test:SUCCESS']).map((i) => i.id)).toEqual([
      'lint:FAILURE',
      'typecheck:ERROR',
    ]);
  });
});

describe('formatPrCi', () => {
  it('绿/红文案带检查名和 PR 号', () => {
    expect(formatPrCiNote({ name: 'test', conclusion: 'green', number: 42, url: 'https://x' })).toContain(
      'CI 绿了',
    );
    expect(formatPrCiNote({ name: 'lint', conclusion: 'red', number: 42, url: 'https://x' })).toContain(
      'CI 红了',
    );
    expect(formatPrCiWakeTask({ checks: parsePrChecksJson(CHECKS)!.filter((c) => c.conclusion === 'red'), number: 42, url: 'https://x' })).toContain(
      'lint',
    );
  });
});
