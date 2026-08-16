export function formatCliExitError(name: string, exitCode: number | null, stderr: string): string {
  const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 400);
  if (exitCode === null) {
    return detail ? `${name} 启动失败: ${detail}` : `${name} 启动失败`;
  }
  return detail ? `${name} 退出码 ${exitCode}: ${detail}` : `${name} 退出码 ${exitCode}`;
}
