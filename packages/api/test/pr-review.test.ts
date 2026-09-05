import { describe, expect, it } from 'vitest';
import {
  createFixedPrReviewList,
  formatPrReviewNote,
  formatPrReviewWakeTask,
  parsePrReviewJson,
  selectUnseenPrReviews,
} from '../src/services/pr.js';

const COMMENTS = JSON.stringify([
  { id: 9001, body: '边界条件没处理', user: { login: 'reviewer-hr', type: 'User' },
    html_url: 'https://github.com/example/repo/pull/42#issuecomment-9001', created_at: '2026-09-05T00:00:00Z' },
  { id: 9002, body: '覆盖率 +2%', user: { login: 'codecov-bot', type: 'Bot' } },
]);
const REVIEWS = JSON.stringify([
  { id: 77, body: '整体可以,小改一处', user: { login: 'boss', type: 'User' },
    html_url: 'https://github.com/example/repo/pull/42#pullrequestreview-77', submitted_at: '2026-09-05T01:00:00Z' },
  { id: 78, body: '   ', user: { login: 'boss', type: 'User' } }, // 空 body 的 review 丢弃
]);

describe('parsePrReviewJson', () => {
  it('合并 issue comments 和 reviews,id 加来源前缀,作者类型归三档', () => {
    const items = parsePrReviewJson(COMMENTS, REVIEWS);
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.id)).toEqual(['c9001', 'c9002', 'r77']);
    expect(items![0]).toMatchObject({ author: 'reviewer-hr', authorType: 'User', htmlUrl: expect.stringContaining('issuecomment-9001') });
    expect(items![1]!.authorType).toBe('Bot');
  });
  it('任一输入不是 JSON 返回 null', () => {
    expect(parsePrReviewJson('not json', REVIEWS)).toBeNull();
    expect(parsePrReviewJson(COMMENTS, '{}')).toBeNull();
  });
  it('comment 缺 number 型 id 或 string 型 body 时跳过', () => {
    const raw = JSON.stringify([
      { id: '9001', body: 'id 是字符串,跳过', user: { login: 'a', type: 'User' } },
      { id: 9002, user: { login: 'b', type: 'User' } }, // 没 body,跳过
      { id: 9003, body: 42, user: { login: 'c', type: 'User' } }, // body 不是字符串,跳过
      { id: 9004, body: '正常', user: { login: 'd', type: 'User' } },
    ]);
    const items = parsePrReviewJson(raw, '[]');
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.id)).toEqual(['c9004']);
  });
  it('user.type 不是 User/Bot 时 authorType 归 Other', () => {
    const raw = JSON.stringify([
      { id: 9001, body: 'x', user: { login: 'ghost', type: 'Mannequin' } },
      { id: 9002, body: 'y', user: { login: 'no-type' } },
    ]);
    const items = parsePrReviewJson(raw, '[]');
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.authorType)).toEqual(['Other', 'Other']);
  });
});

describe('selectUnseenPrReviews', () => {
  it('过滤掉已见 id', () => {
    const items = parsePrReviewJson(COMMENTS, REVIEWS)!;
    expect(selectUnseenPrReviews(items, ['c9001', 'r77']).map((i) => i.id)).toEqual(['c9002']);
    expect(selectUnseenPrReviews(items, [])).toHaveLength(3);
  });
});

describe('format', () => {
  it('评论消息带作者和 PR 号', () => {
    const note = formatPrReviewNote({ author: 'reviewer-hr', body: '边界条件没处理', number: 42, url: 'https://x' });
    expect(note).toContain('reviewer-hr');
    expect(note).toContain('42');
    expect(note).toContain('边界条件没处理');
  });
  it('叫醒任务逐条带评论', () => {
    const items = parsePrReviewJson(COMMENTS, REVIEWS)!;
    const task = formatPrReviewWakeTask({ comments: items, number: 42, url: 'https://x' });
    expect(task).toContain('reviewer-hr');
    expect(task).toContain('boss');
    expect(task).toContain('codecov-bot');
    expect(task).toContain('覆盖率 +2%');
  });
});

describe('createFixedPrReviewList', () => {
  it('user/bot 各吐一条对应类型的评论', async () => {
    const user = await createFixedPrReviewList('user')({ workdir: '/tmp', number: 42 });
    const bot = await createFixedPrReviewList('bot')({ workdir: '/tmp', number: 42 });
    expect(user.ok && user.items[0]!.authorType).toBe('User');
    expect(bot.ok && bot.items[0]!.authorType).toBe('Bot');
    expect(user.ok && user.items[0]!.author).toBe('reviewer-hr');
    expect(bot.ok && bot.items[0]!.author).toBe('codecov-bot');
    expect(user.ok && user.items[0]!.body).toBe('这里的边界条件没处理,除零要炸');
    expect(bot.ok && bot.items[0]!.body).toBe('这里的边界条件没处理,除零要炸');
  });
});
