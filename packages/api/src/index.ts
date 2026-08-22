import { resolve } from 'node:path';
import { resolveListenHost } from '@meowbase/shared';
import { startApp } from './app.js';

const repoRoot = resolve(import.meta.dirname, '../../../');
const started = await startApp({
  repoRoot,
  configPath: resolve(repoRoot, 'meowbase.config.json'),
  host: resolveListenHost(process.env),
  rebuildAdapter: true,
});
console.log(`meowbase api 已启动: http://localhost:${started.port}`);
