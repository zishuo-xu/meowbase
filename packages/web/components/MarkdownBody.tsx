import type { ReactNode } from 'react';
import { parseMarkdown, type MdInline } from '@/lib/parse-markdown';

function Inline({ nodes }: { nodes: MdInline[] }): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.text;
    if (node.type === 'code') {
      return (
        <code key={i} className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.85em]">
          {node.text}
        </code>
      );
    }
    if (node.type === 'strong') {
      return (
        <strong key={i} className="font-bold">
          <Inline nodes={node.children} />
        </strong>
      );
    }
    return (
      <em key={i}>
        <Inline nodes={node.children} />
      </em>
    );
  });
}

const HEADING = {
  1: 'mt-2 text-base font-bold',
  2: 'mt-2 text-sm font-bold',
  3: 'mt-1.5 text-sm font-semibold',
} as const;

export function MarkdownBody({
  text,
  trailing,
}: {
  text: string;
  trailing?: ReactNode;
}) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return trailing ? <>{trailing}</> : null;

  return (
    <div className="break-words [&_p+p]:mt-2">
      {blocks.map((block, i) => {
        const last = i === blocks.length - 1;
        if (block.type === 'heading') {
          const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3');
          return (
            <Tag key={i} className={HEADING[block.level]}>
              <Inline nodes={block.children} />
              {last ? trailing : null}
            </Tag>
          );
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={`my-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, j) => (
                <li key={j} className="my-0.5">
                  <Inline nodes={item} />
                  {last && j === block.items.length - 1 ? trailing : null}
                </li>
              ))}
            </List>
          );
        }
        if (block.type === 'code') {
          return (
            <pre
              key={i}
              className="my-2 max-w-full overflow-x-auto rounded-lg bg-black/[0.06] px-2.5 py-2 font-mono text-[11px] leading-snug"
            >
              <code>{block.text}</code>
              {last ? trailing : null}
            </pre>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            <Inline nodes={block.children} />
            {last ? trailing : null}
          </p>
        );
      })}
    </div>
  );
}
