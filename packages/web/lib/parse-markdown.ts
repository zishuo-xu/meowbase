export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'evidence'; id: string };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] }
  | { type: 'code'; lang?: string; text: string };

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += value;
    else out.push({ type: 'text', text: value });
  };

  while (i < text.length) {
    const ev = text.slice(i).match(/^#ev_[a-f0-9]{8}\b/);
    if (ev) {
      out.push({ type: 'evidence', id: ev[0].slice(1) });
      i += ev[0].length;
      continue;
    }
    if (text.startsWith('`', i)) {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        out.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        out.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (text.startsWith('*', i) && text[i + 1] !== ' ' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i) {
        out.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    pushText(text[i] ?? '');
    i += 1;
  }
  return out;
}

const UL = /^[-*]\s+(.+)$/;
const OL = /^(\d+)\.\s+(.+)$/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const FENCE = /^```(\w*)$/;

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    const text = buf.join('\n').trim();
    if (text) blocks.push({ type: 'paragraph', children: parseInline(text) });
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fence = line.trim().match(FENCE);
    if (fence) {
      const lang = fence[1] || undefined;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }

    const ul = line.match(UL);
    const ol = line.match(OL);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const item = ordered ? (lines[i] ?? '').match(OL) : (lines[i] ?? '').match(UL);
        if (!item) break;
        items.push(parseInline((ordered ? item[2] : item[1]) ?? ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (!next.trim()) break;
      if (FENCE.test(next.trim()) || HEADING.test(next) || UL.test(next) || OL.test(next)) break;
      para.push(next);
      i += 1;
    }
    flushParagraph(para);
  }

  return blocks;
}
