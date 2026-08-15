import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSkillStore } from '../src/stores/file-skill-store.js';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'skills-fixture');

describe('FileSkillStore', () => {
  it('加载 manifest 与 prompt 文件', async () => {
    const store = new FileSkillStore(FIXTURE_DIR);
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('tdd');
    expect(list[0]?.prompt).toContain('红-绿-重构');
    expect((await store.get('tdd'))?.triggers).toEqual(['tdd', '测试驱动']);
    expect(await store.get('不存在')).toBeNull();
  });
});
