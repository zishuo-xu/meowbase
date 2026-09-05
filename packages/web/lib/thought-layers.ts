export interface ThoughtLayers {
  thinking: string;
  plan: string;
}

const PLAN_HEAD = /^\s*(?:计划|Plan)\s*[:：]\s*(.*)$/i;

/** 从思考原文拆出计划。只认行首「计划:」/「Plan:」,不碰对用户说的话。 */
export function splitThoughtLayers(raw: string): ThoughtLayers {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.trim()) return { thinking: '', plan: '' };
  const lines = text.split('\n');
  const index = lines.findIndex((line) => PLAN_HEAD.test(line));
  if (index < 0) return { thinking: text.trim(), plan: '' };
  const match = lines[index]?.match(PLAN_HEAD);
  const rest = lines.slice(index + 1);
  const first = (match?.[1] ?? '').trim();
  const planLines = first ? [first, ...rest] : rest;
  return {
    thinking: lines.slice(0, index).join('\n').trim(),
    plan: planLines.join('\n').trim(),
  };
}
