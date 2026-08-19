/** 解析平台写入的接力系统消息;无详情则只显示一行。 */
export function parseRelayNote(message: {
  content: string;
  systemKind?: string;
}): { headline: string; details: string[] } | null {
  const lines = message.content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headline = lines[0];
  if (!headline) return null;
  const tagged = message.systemKind === 'relay';
  if (!tagged && !headline.includes('🤝 接力:')) return null;
  return { headline, details: lines.slice(1) };
}
