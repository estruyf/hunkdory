// Search the branch's code from a review: "where is this used?" without leaving Hunkdory.
// Opens with / or Cmd+F, filled in with the text you selected, like a name in a question.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeSearchResult, ReviewData } from '../../shared/types.ts';
import { cleanError, plural } from './ui.tsx';

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
      const typing = !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      const find = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'f';
      const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!find && !slash) return;
      e.preventDefault();
      show(selectedText());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const button = (
    <button
      type="button"
      className="btn"
      style={{ height: 36, gap: 8 }}
      title="Search the branch's code (/ or ⌘F). Select a name first to search for it."
      // Read the selection before the click takes it away.
      onMouseDown={(e) => {
        e.preventDefault();
        show(selectedText());
      }}
    >
      Search code <span className="kbd">/</span>
    </button>
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
        if (e.key === 'Escape') onClose();
      }}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(620px, 92vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 32px var(--panel-shadow)', zIndex: 30, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ fontSize: 15 }}>Search code</h2>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {data.branch}
          </span>
          <button type="button" className="link" style={{ fontSize: 13 }} onClick={onClose}>
            Close <span className="kbd">esc</span>
          </button>
        </div>
        <input ref={input} className="field mono" aria-label="Text to search for" placeholder="A function, a name, any text" value={query} onChange={(e) => setQuery(e.target.value)} style={{ height: 38, fontSize: 13.5 }} />
        <span role="status" style={{ fontSize: 12.5, color: res?.error ? 'var(--high-fg)' : 'var(--muted)' }}>
          {status}
        </span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 16 }}>
        {groups.map(([path, matches]) => {
          const step = idx.files.get(path);
          return (
            <section key={path} style={{ borderBottom: '1px solid var(--divider)', padding: '10px 0 6px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', padding: '0 18px 4px' }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, overflowWrap: 'anywhere', flex: '1 1 300px' }}>
                  {path}
                </span>
                {step && (
                  <button type="button" className="link" style={{ fontSize: 12.5 }} title={`Step ${step.index + 1}: ${step.title}`} onClick={() => onShowStep(step.stepKey)}>
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 18px' }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={open ? 'Hide the lines around it' : 'Show the lines around it'}
          style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }}
        >
          <span className="mono" style={{ width: 44, flex: 'none', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
            {match.line}
          </span>
          <span className="mono" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 }}>
            <Marked text={match.text.trimStart()} query={query} />
          </span>
        </button>
        {changed && (
          <button type="button" className="pill accent" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 600, flex: 'none' }} title={`Changed in step ${changed.index + 1}: ${changed.title}`} onClick={() => onShowStep(changed.stepKey)}>
            Changed · step {changed.index + 1}
          </button>
        )}
      </div>
      {open && context && (
        <pre className="mono" style={{ margin: '4px 18px 8px 72px', padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--divider)', borderRadius: 8, fontSize: 12, lineHeight: 1.6, overflowX: 'auto' }}>
          {context.lines.map((l, i) => {
            const n = context.from + i;
            return (
              <div key={n} style={{ display: 'flex', gap: 12, background: n === match.line ? 'var(--line-hit)' : undefined }}>
                <span style={{ width: 36, flex: 'none', textAlign: 'right', color: 'var(--muted)' }}>{n}</span>
                <span style={{ whiteSpace: 'pre' }}>{l}</span>
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
