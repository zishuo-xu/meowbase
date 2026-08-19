#!/usr/bin/env node
// 审查官 fake:gemini stream-json(init/message/result)。单独一行「通过」,并带命令+结果。
const delayMs = Number(process.env.FAKE_REVIEWER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const text =
  '已运行 `node -e "console.log(\'ok\')"`\n输出 ok，行为正确。\n\n通过';
process.stdout.write(
  '{"type":"init","session_id":"sess-reviewer","model":"fake-gemini"}\n' +
    `{"type":"message","role":"assistant","content":${JSON.stringify(text)},"session_id":"sess-reviewer"}\n` +
    '{"type":"result","status":"success","session_id":"sess-reviewer","stats":{"input_tokens":15,"output_tokens":8,"total_tokens":23,"cached":0}}\n',
);
