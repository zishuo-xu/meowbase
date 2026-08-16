#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(
  process.env.RECORD_ARGS_FILE ?? '/tmp/claude-args.txt',
  JSON.stringify(process.argv.slice(2)),
);
if (process.env.RECORD_ENV_FILE) {
  writeFileSync(
    process.env.RECORD_ENV_FILE,
    JSON.stringify({
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? null,
      OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? null,
    }),
  );
}
process.stdout.write(
  '{"type":"system","subtype":"init","session_id":"sess-args"}\n' +
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]},"session_id":"sess-args"}\n' +
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"sess-args","total_cost_usd":0}\n',
);
