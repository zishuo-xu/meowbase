import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 测试直接指向 shared 源码,避免 dist 过期导致的运行时解析错误
      '@meowbase/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
