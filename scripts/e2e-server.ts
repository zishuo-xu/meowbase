import { resolve } from 'node:path';
import { startApp } from '../packages/api/src/app.js';

const repoRoot = resolve(import.meta.dirname, '..');
// 不传 configPath:不读、不写仓库根 meowbase.config.json(那是用户本地运行时配置)
try {
  const started = await startApp({
    repoRoot,
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 0),
  });
  console.log(`E2E_API_READY http://127.0.0.1:${started.port}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
