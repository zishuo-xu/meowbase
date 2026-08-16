#!/usr/bin/env node
process.stdout.write(
  '{"type":"step_start","sessionID":"ses-fake","part":{"type":"step-start"}}\n' +
    '{"type":"text","sessionID":"ses-fake","part":{"type":"text","text":"审查通过"}}\n' +
    '{"type":"step_finish","sessionID":"ses-fake","part":{"type":"step-finish","reason":"stop","tokens":{"total":50,"input":5,"output":4}},"cost":0.00001}\n',
);
