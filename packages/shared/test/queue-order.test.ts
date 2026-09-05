import { describe, expect, it } from 'vitest';
import { isUrgentInbound, moveQueueItem } from '../src/queue-order.js';

describe('isUrgentInbound', () => {
  it('行首 ! / ！ / 急 算急件,前面可有空白', () => {
    expect(isUrgentInbound('!先看这个')).toBe(true);
    expect(isUrgentInbound('！先看这个')).toBe(true);
    expect(isUrgentInbound('急 先看这个')).toBe(true);
    expect(isUrgentInbound('  !先看')).toBe(true);
  });

  it('句中感叹或普通正文不算', () => {
    expect(isUrgentInbound('先看这个!')).toBe(false);
    expect(isUrgentInbound('补一句')).toBe(false);
    expect(isUrgentInbound('#approve ap_aaaaaaaa')).toBe(false);
  });
});

describe('moveQueueItem', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('省略 beforeId 挪到队头', () => {
    expect(moveQueueItem(list, 'c')?.map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(moveQueueItem(list, 'a')?.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('beforeId 空挪到队尾', () => {
    expect(moveQueueItem(list, 'a', null)?.map((row) => row.id)).toEqual(['b', 'c', 'a']);
    expect(moveQueueItem(list, 'c', '')?.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('插到指定条前面', () => {
    expect(moveQueueItem(list, 'c', 'b')?.map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  it('找不到原条或目标返回 null', () => {
    expect(moveQueueItem(list, 'nope')).toBeNull();
    expect(moveQueueItem(list, 'c', 'nope')).toBeNull();
  });
});
