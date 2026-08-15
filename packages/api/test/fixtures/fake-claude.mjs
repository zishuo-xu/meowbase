#!/usr/bin/env node
const lines = [
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-fake"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"你好!"}],"usage":{"input_tokens":10,"output_tokens":3}},"session_id":"sess-fake"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":" 我是 claude。"}]},"session_id":"sess-fake"}',
  '{"type":"result","subtype":"success","is_error":false,"result":"你好! 我是 claude。","session_id":"sess-fake","total_cost_usd":0.0012,"usage":{"input_tokens":10,"output_tokens":3}}',
];
process.stdout.write(lines.join('\n') + '\n');
