import { expect, test, type Page } from '@playwright/test';

const TASK = '在沙箱写 add.ts,导出 add(a,b),写完自检。';

test.describe.configure({ mode: 'serial' });

test.describe('演示主路径', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: '+ 新会话' }).click();
    await expect(page.getByPlaceholder(/@墨墨/)).toBeVisible();
    await expect(page.locator('aside').getByText('墨墨', { exact: true }).first()).toBeVisible();
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('补全菜单里 Enter 是选候选不是发送', async () => {
    const input = page.getByPlaceholder(/@墨墨/);
    await input.click();
    await input.pressSequentially('@');
    await expect(page.getByText('Enter / Tab 选中 · ↑↓ 移动 · Esc 关闭')).toBeVisible();
    await input.press('Enter');
    await expect(input).toHaveValue('@墨墨 ');
    await expect(page.locator('.justify-end')).toHaveCount(0);
    await expect(page.locator('[data-cat-ear]')).toHaveCount(0);
    await input.fill('');
  });

  test('多行输入:Shift+Enter 换行后 @团团 自己占一行', async () => {
    const input = page.getByPlaceholder(/@墨墨/);
    await input.click();
    await input.pressSequentially(TASK);
    await input.press('Shift+Enter');
    await input.pressSequentially('@团团');
    await input.press('Escape');
    await page.getByRole('button', { name: '发送' }).click();

    const bubble = page.locator('.justify-end').filter({ hasText: '@团团' });
    await expect(bubble).toHaveCount(1);
    const text = await bubble.innerText();
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines, '用户气泡里 @团团 必须自己占一行,不能和正文挤成一段').toContain('@团团');
    expect(
      lines.some((line) => line.includes(TASK) && line.includes('@团团')),
      '第一行和 @团团 挤在同一行了',
    ).toBe(false);
    expect(lines[0]).toContain('add.ts');
  });

  test('行首 @ 真的路由到团团(非主猫)', async () => {
    const first = page.locator('[data-cat-ear]').first();
    await expect(first.getByText('团团', { exact: true })).toBeVisible();
    await expect(first.locator('.text-xs.font-bold')).toHaveText('团团');
    await expect(first.locator('.text-xs.font-bold')).not.toHaveText('墨墨');
  });

  test('看得见的收尾:接力、球权、审批卡、批准后已落地', async () => {
    await expect(page.getByText('🤝 接力:团团 → 闪闪')).toBeVisible();
    await expect(page.getByText('球在人手里')).toBeVisible();
    await expect(page.getByRole('button', { name: '批准落地' })).toBeVisible();
    await page.getByRole('button', { name: '批准落地' }).click();
    await expect(page.getByText('已落地，等人开口')).toBeVisible();
  });
});
