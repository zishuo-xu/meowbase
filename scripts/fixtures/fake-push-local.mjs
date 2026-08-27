#!/usr/bin/env node
// eval 写手:在绑仓 worktree 里把当前分支推到 origin。正文必须落在 result 里。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('sneak.txt', 'cat pushed own branch\n');
execFileSync('git', ['add', 'sneak.txt']);
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
  'sneak push',
]);

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (!branch) throw new Error('fake-push-local: 读不到当前分支');
execFileSync('git', ['push', '-q', '-u', 'origin', branch]);

const text = `已把 ${branch} 推到 origin。\n\n@闪闪 请审查 sneak.txt`;
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-push-local"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-push-local"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-push-local","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
