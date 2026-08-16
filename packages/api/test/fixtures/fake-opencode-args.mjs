#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(
  process.env.RECORD_ARGS_FILE ?? '/tmp/opencode-args.txt',
  JSON.stringify(process.argv.slice(2)),
);
process.stdout.write(
  '{"type":"step_start","sessionID":"ses-args","part":{"type":"step-start"}}\n' +
    '{"type":"text","sessionID":"ses-args","part":{"type":"text","text":"ok"}}\n' +
    '{"type":"step_finish","sessionID":"ses-args","part":{"type":"step-finish","reason":"stop","tokens":{"total":10,"input":5,"output":3}},"cost":0.00001}\n',
);
