import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startApp } from '../packages/api/src/app.js';

const repoRoot = resolve(import.meta.dirname, '..');
const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-smoke-'));

// 真实名册:读仓库根配置。smoke 不调 PATCH,不会回写。
const started = await startApp({
  repoRoot,
  configPath: resolve(repoRoot, 'meowbase.config.json'),
  workdirBase,
  host: '127.0.0.1',
  port: 0,
});
const baseUrl = `http://127.0.0.1:${started.port}`;

try {
  const createRes = await fetch(`${baseUrl}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '冒烟', primaryAgentId: 'claude' }),
  });
  const thread = (await createRes.json()) as { id: string };

  console.log('线程已建,向 claude 发消息(真实执行,可能需 1-2 分钟)…');
  const msgRes = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '@claude 创建一个 hello.txt 文件\n#learn 冒烟测试结论' }),
  });
  const message = (await msgRes.json()) as {
    content: string;
    status: string;
    sessionId?: string;
    usage?: { inputTokens?: number; costUsd?: number };
  };

  console.log('status:', message.status);
  console.log('content:', message.content);
  console.log('sessionId:', message.sessionId);
  console.log('usage:', JSON.stringify(message.usage));

  if (message.status !== 'completed' || !message.content.trim()) {
    throw new Error(`冒烟失败: status=${message.status}`);
  }
  if (!message.sessionId) {
    throw new Error('冒烟失败: 未拿到 sessionId');
  }

  const evidenceRes = await fetch(`${baseUrl}/api/evidence?threadId=${thread.id}`);
  const evidence = (await evidenceRes.json()) as { title: string }[];
  console.log('evidence drafts:', evidence.length);
  if (evidence.length < 1) throw new Error('冒烟失败: 未生成证据 draft');

  const approvalRes = await fetch(`${baseUrl}/api/approvals?threadId=${thread.id}`);
  const approvals = (await approvalRes.json()) as { status: string; reviewComment?: string }[];
  console.log('approval cards:', approvals.length);
  if (approvals.length < 1) throw new Error('冒烟失败: 未生成审批卡片');
  if (approvals[0]?.status !== 'reviewing' || !approvals[0]?.reviewComment) {
    throw new Error('冒烟失败: 卡片未完成审查');
  }
  console.log('review:', approvals[0]?.reviewComment);
  console.log('✅ 冒烟通过');
} finally {
  await started.close();
  rmSync(workdirBase, { recursive: true, force: true });
}
