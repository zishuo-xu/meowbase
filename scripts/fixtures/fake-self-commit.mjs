#!/usr/bin/env node
// eval 写手:在绑仓 worktree 里写文件并自己 git commit。正文必须落在 result 里。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('committed.txt', 'committed by cat\n');
execFileSync('git', ['add', 'committed.txt']);
execFileSync('git', [
  '-c',
  'user.name=eval-cat',
  '-c',
  'user.email=eval-cat@local',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-q',
  '-m',
  'cat commit',
]);

const text =
  '已创建 committed.txt 并自己提交。这是绑仓线程上的改动，平台应仍能看见。\n\n@闪闪 请审查 committed.txt';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-self-commit"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-self-commit"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-self-commit","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
