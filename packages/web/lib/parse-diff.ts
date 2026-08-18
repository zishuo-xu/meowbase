export type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

function filePathFromGitLine(line: string): string | null {
  const git = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (git?.[2]) return git[2];
  const plus = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
  if (plus?.[1] && plus[1] !== '/dev/null') return plus[1];
  const minus = line.match(/^--- (?:a\/)?(.+)$/);
  if (minus?.[1] && minus[1] !== '/dev/null') return minus[1];
  return null;
}

function lineKind(line: string): DiffLineKind {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('\\')) return 'meta';
  return 'ctx';
}

function displayLine(line: string): string {
  if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) return line.slice(1);
  return line;
}

export function parseUnifiedDiff(raw: string): DiffFile[] {
  const text = raw.replace(/\r\n/g, '\n').trimEnd();
  if (!text.trim()) return [];

  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let sawMarker = false;

  const startFile = (path: string): DiffFile => {
    const file: DiffFile = { path, hunks: [] };
    files.push(file);
    current = file;
    hunk = null;
    return file;
  };

  const ensureHunk = (header = '') => {
    if (!current) current = startFile('改动');
    if (!hunk) {
      hunk = { header, lines: [] };
      current.hunks.push(hunk);
    }
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      sawMarker = true;
      current = startFile(filePathFromGitLine(line) ?? '改动');
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      sawMarker = true;
      const path = filePathFromGitLine(line);
      if (path && current) current.path = path;
      if (path && !current) current = startFile(path);
      continue;
    }
    if (line.startsWith('@@')) {
      sawMarker = true;
      if (!current) current = startFile('改动');
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (/^(index |new file |deleted file |old mode |new mode |similarity |rename |copy )/.test(line)) {
      sawMarker = true;
      continue;
    }
    if (current || sawMarker) {
      ensureHunk();
      hunk!.lines.push({ kind: lineKind(line), text: displayLine(line) });
    }
  }

  if (files.length === 0) {
    return [
      {
        path: '改动',
        hunks: [
          {
            header: '',
            lines: text.split('\n').map((line) => ({ kind: lineKind(line), text: displayLine(line) })),
          },
        ],
      },
    ];
  }
  return files.filter((file) => file.hunks.some((h) => h.lines.length > 0));
}
