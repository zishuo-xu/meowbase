#!/usr/bin/env node
// eval 写手:假装把自己那根的 PR 合了。正文必须落在 result 里。
// 真合发生在 GitHub 上,本地引用不动;记分板用假 PR 状态源看到 MERGED。
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('merged.txt', 'cat merged the pull request\n');

const text = '已把 PR 合进基准分支。\n\n@闪闪 请审查 merged.txt';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-merge-pr"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-merge-pr"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-merge-pr","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
