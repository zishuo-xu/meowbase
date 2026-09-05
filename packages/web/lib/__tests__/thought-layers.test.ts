import { describe, expect, it } from 'vitest';
import { splitThoughtLayers } from '../thought-layers';

describe('splitThoughtLayers', () => {
  it('没有计划标题则整段仍是思考', () => {
    expect(splitThoughtLayers('先看目录再写文件')).toEqual({
      thinking: '先看目录再写文件',
      plan: '',
    });
  });

  it('行首 计划: 后面是计划,前面是思考', () => {
    expect(splitThoughtLayers('先看目录\n计划:\n1. 写 add.ts\n2. 自检')).toEqual({
      thinking: '先看目录',
      plan: '1. 写 add.ts\n2. 自检',
    });
  });
});
