import { describe, expect, it } from 'vitest';
import { createMemoryStores } from '../src/stores/factories.js';
import { ensureSeededProfiles, SEED_PROFILES } from '../src/stores/seeds.js';

describe('ensureSeededProfiles', () => {
  it('种子写入后幂等', async () => {
    const { profiles } = createMemoryStores();
    await ensureSeededProfiles(profiles);
    await ensureSeededProfiles(profiles);
    const list = await profiles.list();
    expect(list.length).toBe(SEED_PROFILES.length);
    expect(list.map((p) => p.name)).toEqual(['墨墨', '闪闪', '团团']);
  });
});
