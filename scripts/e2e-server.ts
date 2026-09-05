import { resolve } from 'node:path';
import { startApp } from '../packages/api/src/app.js';
import {
  createFixedPrChecks,
  createFixedPrReviewList,
  createMergedPrLookup,
  createOpenPrLookup,
} from '../packages/api/src/services/pr.js';

const repoRoot = resolve(import.meta.dirname, '..');
// 不传 configPath:不读、不写仓库根 meowbase.config.json(那是用户本地运行时配置)
// 假 PR 源只认在这里,不进 startApp——生产进程不该有「假装 PR 已合并」的开关
// 假评论源同理:MEOW_PR_REVIEW_FAKE=user|bot 时顺带把 PR 状态钉成 OPEN(评论只在 OPEN 上查)
try {
  const started = await startApp({
    repoRoot,
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 0),
    ...(process.env.MEOW_PR_FAKE === 'merged' ? { lookupPr: createMergedPrLookup() } : {}),
    ...(process.env.MEOW_PR_REVIEW_FAKE === 'user' || process.env.MEOW_PR_REVIEW_FAKE === 'bot'
      ? {
          lookupPr: createOpenPrLookup(),
          listPrReviews: createFixedPrReviewList(process.env.MEOW_PR_REVIEW_FAKE),
        }
      : {}),
    ...(process.env.MEOW_PR_CI_FAKE === 'green' || process.env.MEOW_PR_CI_FAKE === 'red'
      ? {
          lookupPr: createOpenPrLookup(),
          listPrChecks: createFixedPrChecks(process.env.MEOW_PR_CI_FAKE),
        }
      : {}),
  });
  console.log(`E2E_API_READY http://127.0.0.1:${started.port}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
