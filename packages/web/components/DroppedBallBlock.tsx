'use client';

export function DroppedBallBlock({
  text,
  agents,
  onPass,
  onSpeak,
}: {
  text: string;
  agents: { id: string; name: string }[];
  onPass: (agentName: string) => void;
  onSpeak?: () => void;
}) {
  return (
    <div className="flex justify-center px-4 py-2">
      <div className="max-w-md rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-950 ring-1 ring-amber-200">
        <div>{text}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onPass(agent.name)}
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--ink)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]/10"
            >
              交给{agent.name}
            </button>
          ))}
          {onSpeak ? (
            <button
              type="button"
              onClick={onSpeak}
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--ink-soft)] ring-1 ring-[var(--border)] hover:bg-white"
            >
              我来说
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
