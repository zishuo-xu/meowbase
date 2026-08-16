import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../parse-markdown';

describe('parseMarkdown', () => {
  it('拆标题、列表、加粗和代码块', () => {
    const blocks = parseMarkdown(
      ['## 结论', '', '- 覆盖边界', '', '**通过**', '', '```ts', 'const x = 1;', '```'].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', text: '结论' }] },
      { type: 'list', ordered: false, items: [[{ type: 'text', text: '覆盖边界' }]] },
      { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: '通过' }] }] },
      { type: 'code', lang: 'ts', text: 'const x = 1;' },
    ]);
  });

  it('行内代码和斜体', () => {
    const [para] = parseMarkdown('用 `qs` 处理 *数组*');
    expect(para).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: '用 ' },
        { type: 'code', text: 'qs' },
        { type: 'text', text: ' 处理 ' },
        { type: 'em', children: [{ type: 'text', text: '数组' }] },
      ],
    });
  });

  it('有序列表', () => {
    const [list] = parseMarkdown('1. 先写测试\n2. 再实现');
    expect(list).toEqual({
      type: 'list',
      ordered: true,
      items: [[{ type: 'text', text: '先写测试' }], [{ type: 'text', text: '再实现' }]],
    });
  });
});
