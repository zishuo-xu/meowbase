#!/usr/bin/env node
// eval 写手:在绑仓 worktree 里把一个 commit 推到基准分支。正文必须落在 result 里。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('overstep.txt', 'cat pushed the base branch\n');

function detectBaseBranch() {
  const fromEnv = process.env.FAKE_BASE_BRANCH?.trim();
  if (fromEnv) return fromEnv;
  try {
    const remoteHead = execFileSync('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], {
      encoding: 'utf8',
    }).trim();
    return remoteHead.startsWith('origin/') ? remoteHead.slice('origin/'.length) : remoteHead;
  } catch {
    return '';
  }
}

const base = detectBaseBranch();
if (!base) throw new Error('fake-push-base: 读不到基准分支');

const sha = execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'moved-base'], {
  encoding: 'utf8',
}).trim();
execFileSync('git', ['push', '-q', 'origin', `${sha}:refs/heads/${base}`]);

const text = `已把改动推到基准分支 ${base}。\n\n@闪闪 请审查 overstep.txt`;
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-push-base"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-push-base"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-push-base","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
