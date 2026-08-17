export function formatCliExitError(name: string, exitCode: number | null, stderr: string): string {
  const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 400);
  if (exitCode === null) {
    return detail ? `${name} 启动失败: ${detail}` : `${name} 启动失败`;
  }
  return detail ? `${name} 退出码 ${exitCode}: ${detail}` : `${name} 退出码 ${exitCode}`;
}

/** 从 CLI 的 JSON 事件里抽出给人看的错误。opencode 常把 403 写在 stdout,stderr 是空的。 */
export function extractJsonErrorMessage(obj: Record<string, unknown>): string | undefined {
  const err = obj.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim();
    const data = rec.data;
    if (data && typeof data === 'object') {
      const msg = (data as Record<string, unknown>).message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
  }
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
  return undefined;
}
