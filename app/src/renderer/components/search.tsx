// Search the branch's code from a review: "where is this used?" without leaving Hunkdory.
// Opens with ⌘F (the registry's `find`), filled in with the text you selected, like a name in a question.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeSearchResult, ReviewData } from '../../shared/types.ts';
import { Search, X } from 'lucide-react';
import { matches } from '../lib/shortcuts.ts';
import { cleanError, plural } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import { Pill } from './ui/Pill.tsx';
import { FIELD_LG } from './ui/field.ts';

type StepRef = { stepKey: string; index: number; title: string };

/** Which step changed a line, and which step a file is first in. */
function changeIndex(data: ReviewData) {
  const lines = new Map<string, StepRef>();
  const files = new Map<string, StepRef>();
  for (const s of data.steps) {
    for (const id of s.hunkIds) {
      const h = data.hunks[id];
      if (!h) continue;
      const ref = { stepKey: s.key, index: s.index, title: s.title };
      if (!files.has(h.path)) files.set(h.path, ref);
      for (const l of h.lines) if (l.kind === 'add' && l.newN) lines.set(`${h.path}:${l.newN}`, ref);
    }
  }
  return { lines, files };
}

/** The selection, when it looks like something to search for: one short line. */
function selectedText(): string | undefined {
  const sel = window.getSelection()?.toString().trim() ?? '';
  return sel && sel.length <= 120 && !sel.includes('\n') ? sel : undefined;
}

export function useCodeSearch(data: ReviewData, onShowStep: (stepKey: string) => void) {
  const [open, setOpen] = useState(false);
  // Kept while the panel is closed, so it opens where you left it.
  const [query, setQuery] = useState('');
  const show = (prefill?: string) => {
    if (prefill) setQuery(prefill);
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'find')) return;
      e.preventDefault();
      show(selectedText());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const button = (
    <Button
      icon={<Search size={13} aria-hidden />}
      shortcut="find"
      data-tooltip="Search the branch's code. Select a name first to search for it."
      // Read the selection before the click takes it away.
      onMouseDown={(e) => {
        e.preventDefault();
        show(selectedText());
      }}
    >
      Search code
    </Button>
  );

  const panel = open ? (
    <SearchPanel
      data={data}
      query={query}
      setQuery={setQuery}
      onClose={() => setOpen(false)}
      onShowStep={(key) => {
        setOpen(false);
        onShowStep(key);
      }}
    />
  ) : null;

  return { button, panel };
}

function SearchPanel({ data, query, setQuery, onClose, onShowStep }: { data: ReviewData; query: string; setQuery: (q: string) => void; onClose: () => void; onShowStep: (stepKey: string) => void }) {
  const [res, setRes] = useState<{ q: string; value?: CodeSearchResult; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const idx = useMemo(() => changeIndex(data), [data]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRes(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      window.api.searchCode(data.projectId, data.branch, q).then(
        (value) => live && (setRes({ q, value }), setLoading(false)),
        (e) => live && (setRes({ q, error: cleanError(e) }), setLoading(false))
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, data.projectId, data.branch]);

  // Files this change touches first: those are the ones you're reviewing.
  const groups = useMemo(() => {
    const byFile = new Map<string, CodeSearchResult['matches']>();
    for (const m of res?.value?.matches ?? []) byFile.set(m.path, [...(byFile.get(m.path) ?? []), m]);
    return [...byFile].sort((a, b) => Number(idx.files.has(b[0])) - Number(idx.files.has(a[0])));
  }, [res, idx]);

  const n = res?.value?.matches.length ?? 0;
  const status = loading
    ? 'Searching…'
    : res?.error
      ? res.error
      : res?.value
        ? n
          ? `${plural(n, 'match', 'matches')} in ${plural(groups.length, 'file')}${res.value.truncated ? ' · the first 300, search for something more specific' : ''}`
          : `No matches in ${data.branch}.`
        : 'The whole branch, not only the change. Lower case matches any case.';

  return (
    <div
      role="dialog"
      aria-label="Search code"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="overlay fixed inset-y-0 right-0 z-50 flex w-[min(620px,92vw)] flex-col border-l"
    >
      <div className="drag flex flex-col gap-2 border-b border-border px-4 pt-3 pb-3">
        <div className="flex h-7 items-center gap-2">
          <h2 className="text-title font-semibold">Search code</h2>
          <span className="min-w-0 flex-1 truncate font-mono text-meta text-faint">{data.branch}</span>
          <Button variant="quiet" size="sm" iconOnly aria-label="Close" kbd="Esc" icon={<X size={14} aria-hidden />} onClick={onClose} />
        </div>
        <input ref={input} className={`${FIELD_LG} w-full font-mono`} aria-label="Text to search for" placeholder="A function, a name, any text" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span role="status" className={`text-meta ${res?.error ? 'text-error' : 'text-muted'}`}>
          {status}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {groups.map(([path, matches]) => {
          const step = idx.files.get(path);
          return (
            <section key={path} className="border-b border-border pt-2 pb-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pb-1">
                <span className="min-w-0 flex-[1_1_300px] font-mono text-ui font-semibold break-all">{path}</span>
                {step && (
                  <button type="button" className="text-meta text-link hover:underline" data-tooltip={`Step ${step.index + 1}: ${step.title}`} onClick={() => onShowStep(step.stepKey)}>
                    In this change · step {step.index + 1} →
                  </button>
                )}
              </div>
              {matches.map((m) => (
                <MatchRow key={m.line} data={data} match={m} query={res!.q} changed={idx.lines.get(`${path}:${m.line}`)} onShowStep={onShowStep} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MatchRow({ data, match, query, changed, onShowStep }: { data: ReviewData; match: CodeSearchResult['matches'][number]; query: string; changed?: StepRef; onShowStep: (stepKey: string) => void }) {
  const [context, setContext] = useState<{ from: number; lines: string[] } | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    setOpen(!open);
    if (context) return;
    const from = Math.max(1, match.line - 4);
    const res = await window.api.fileLines(data.projectId, data.branch, match.path, 'new', from, match.line + 4);
    setContext({ from, lines: res.lines });
  };

  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-4 py-0.5">
        <button type="button" onClick={toggle} aria-expanded={open} data-tooltip={open ? 'Hide the lines around it' : 'Show the lines around it'} className="flex min-w-0 flex-1 items-baseline gap-2.5 rounded text-left hover:bg-border/45">
          <span className="w-11 shrink-0 text-right font-mono text-meta text-faint">{match.line}</span>
          <span className="min-w-0 font-mono text-ui whitespace-pre-wrap break-all">
            <Marked text={match.text.trimStart()} query={query} />
          </span>
        </button>
        {changed && (
          <Pill tone="link" onClick={() => onShowStep(changed.stepKey)} data-tooltip={`Changed in step ${changed.index + 1}: ${changed.title}`}>
            Changed · step {changed.index + 1}
          </Pill>
        )}
      </div>
      {open && context && (
        <pre className="mx-4 mt-1 mb-2 ml-[72px] overflow-x-auto rounded-md border border-border bg-code px-2.5 py-2 font-mono text-ui leading-relaxed">
          {context.lines.map((l, i) => {
            const n = context.from + i;
            return (
              <div key={n} className={`flex gap-3 ${n === match.line ? 'bg-accent/20' : ''}`}>
                <span className="w-9 shrink-0 text-right text-faint">{n}</span>
                <span className="whitespace-pre">{l}</span>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

/** The text with every occurrence of the query marked. Lower case queries match any case, like the search. */
function Marked({ text, query }: { text: string; query: string }) {
  const ci = query === query.toLowerCase();
  const hay = ci ? text.toLowerCase() : text;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let i = hay.indexOf(query); i >= 0 && query; i = hay.indexOf(query, i + query.length)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + query.length)}</mark>);
    at = i + query.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
