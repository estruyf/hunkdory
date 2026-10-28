import { useMemo, useState, type ReactNode } from 'react';
import hljs from 'highlight.js/lib/common';
import { ignoreWhitespace, languageFor, splitRows } from '../../shared/diff.ts';
import type { Comment, DiffLine, HunkView } from '../../shared/types.ts';
import { Markdown } from './markdown.tsx';

const MAX_ROWS = 80;
const STEP = 20;

export type DiffMode = 'unified' | 'split';
export type Anchor = { side: 'LEFT' | 'RIGHT'; line: number };

/** Where a comment on this row lands: the new file, or the old one for a removed line. GitHub's sides. */
const anchorOf = (l: DiffLine): Anchor | null => (l.kind === 'del' ? (l.oldN ? { side: 'LEFT', line: l.oldN } : null) : l.newN ? { side: 'RIGHT', line: l.newN } : null);
const same = (a: Anchor | null, b: Anchor | null) => !!a && !!b && a.side === b.side && a.line === b.line;

const cache = new Map<string, string>();
/** One line, highlighted on its own. Multi-line strings and comments lose some colour, which is fine for a diff. */
function highlight(text: string, lang: string | null): string | null {
  if (!lang || !hljs.getLanguage(lang) || text.length > 1000) return null;
  const key = `${lang}\0${text}`;
  let html = cache.get(key);
  if (html === undefined) {
    html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    if (cache.size > 20_000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

function Code({ text, lang }: { text: string; lang: string | null }) {
  const html = highlight(text, lang);
  // highlight.js escapes the text; its output is only its own spans.
  return html === null ? <span className="diff-text">{text}</span> : <span className="diff-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Props {
  hunk: HunkView;
  showNote?: boolean;
  mode?: DiffMode;
  ignoreSpace?: boolean;
  /** Line comments on this hunk. */
  comments?: Comment[];
  /** Saves a line comment; an empty body removes it. Without it, lines can't be commented on. */
  onComment?: (anchor: Anchor, body: string, id?: string) => void;
  /** Reads more of the file, for showing context around the change. */
  loadLines?: (side: 'old' | 'new', from: number, to: number) => Promise<{ lines: string[]; total: number }>;
  /** Shown instead of the diff until opened, e.g. for a change you already reviewed. */
  collapsed?: string | null;
  badge?: ReactNode;
  /** Who wrote the hunk's note: the branch's agent, or Reviewer when it wrote the walkthrough itself. */
  noteBy?: 'agent' | 'reviewer';
}

/** A long path that wraps between folders, not in the middle of a name. The file name stands out. */
function PathLabel({ path }: { path: string }) {
  const all = path.split('/');
  const file = all.pop()!;
  // Deep paths keep their last folders; the full path is in the tooltip.
  const parts = all.length > 3 ? ['…', ...all.slice(-3)] : all;
  return (
    <span className="mono" style={{ fontSize: 13, overflowWrap: 'anywhere' }} title={path}>
      {parts.map((p, i) => (
        <span key={i} style={{ color: 'var(--muted)' }}>
          {p}/<wbr />
        </span>
      ))}
      <span style={{ fontWeight: 600 }}>{file}</span>
    </span>
  );
}

export function DiffHunk({ hunk, showNote = true, mode = 'unified', ignoreSpace = false, comments = [], onComment, loadLines, collapsed, badge, noteBy = 'agent' }: Props) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(!collapsed);
  const [above, setAbove] = useState<DiffLine[]>([]);
  const [below, setBelow] = useState<DiffLine[]>([]);
  const [atEnd, setAtEnd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Anchor | null>(null);
  const lang = useMemo(() => languageFor(hunk.path), [hunk.path]);

  const base = useMemo(() => (ignoreSpace ? ignoreWhitespace(hunk.lines) : hunk.lines), [hunk.lines, ignoreSpace]);
  const shown = all ? base : base.slice(0, MAX_ROWS);
  const lines = [...above, ...shown, ...(all || base.length <= MAX_ROWS ? below : [])];
  // Rows read from the file around the change aren't part of GitHub's diff, so they take no comments.
  const extra = new Set<DiffLine>([...above, ...below]);
  const risks = hunk.risks.filter((r) => r.severity !== 'low');

  // Context can grow at either edge that is an unchanged line of a modified file.
  const expandable = !!loadLines && (hunk.status === 'modified' || hunk.status === 'renamed') && !hunk.synthetic;
  const top = lines[0];
  const bottom = lines.at(-1);
  const canUp = expandable && top?.kind === 'ctx' && (top.newN ?? 1) > 1;
  const canDown = expandable && bottom?.kind === 'ctx' && !atEnd && (all || base.length <= MAX_ROWS);

  const ctx = (texts: string[], fromNew: number, offset: number): DiffLine[] => texts.map((text, i) => ({ kind: 'ctx', newN: fromNew + i, oldN: fromNew + i + offset, text }));
  const grow = async (dir: 'up' | 'down' | 'all') => {
    if (!loadLines) return;
    setLoading(true);
    try {
      if ((dir === 'up' || dir === 'all') && canUp && top?.newN && top.oldN) {
        const to = top.newN - 1;
        const from = dir === 'all' ? 1 : Math.max(1, to - STEP + 1);
        const got = await loadLines('new', from, to);
        setAbove((a) => [...ctx(got.lines, from, top.oldN! - top.newN!), ...a]);
      }
      if ((dir === 'down' || dir === 'all') && canDown && bottom?.newN && bottom.oldN) {
        const from = bottom.newN + 1;
        const got = await loadLines('new', from, dir === 'all' ? Number.MAX_SAFE_INTEGER : from + STEP - 1);
        setBelow((b) => [...b, ...ctx(got.lines, from, bottom.oldN! - bottom.newN!)]);
        if (from + got.lines.length - 1 >= got.total) setAtEnd(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const commentsAt = (a: Anchor | null) => (a ? comments.filter((c) => c.side === a.side && c.line === a.line) : []);
  const num = (n: number | null, l: DiffLine, a: Anchor | null) =>
    onComment && a && !extra.has(l) ? (
      <button type="button" className="diff-n diff-n-btn" title="Comment on this line" aria-label={`Comment on line ${a.line}`} onClick={() => setEditing(a)}>
        {n ?? ''}
      </button>
    ) : (
      <span className="diff-n">{n ?? ''}</span>
    );
  const thread = (a: Anchor | null, key: string) => {
    const list = commentsAt(a);
    const isEditing = same(editing, a);
    if (!list.length && !isEditing) return null;
    return (
      <div key={key} className="diff-thread">
        {list.map((c) => (
          <LineComment key={c.id} comment={c} onSave={(body) => onComment?.(a!, body, c.id)} />
        ))}
        {isEditing && (
          <LineComposer
            onCancel={() => setEditing(null)}
            onSave={(body) => {
              onComment?.(a!, body);
              setEditing(null);
            }}
          />
        )}
      </div>
    );
  };

  let body: ReactNode;
  if (!hunk.lines.length) {
    body = (
      <div style={{ padding: '12px 16px', fontSize: 13.5, color: 'var(--muted)' }}>
        {hunk.synthetic === 'binary' ? 'Binary file. No text diff to show.' : hunk.synthetic === 'rename' ? `Renamed from ${hunk.oldPath} without content changes.` : 'File mode changed.'}
      </div>
    );
  } else if (mode === 'split') {
    body = (
      <div className="diff split">
        {splitRows(lines).flatMap((r, i) => {
          const la = r.left && r.left.kind !== 'ctx' ? anchorOf(r.left) : null;
          const ra = r.right ? anchorOf(r.right) : null;
          const cell = (l: DiffLine | null, a: Anchor | null, side: 'old' | 'new') =>
            l ? (
              <div className={`diff-cell ${l.kind}${extra.has(l) ? ' extra' : ''}`}>
                {num(side === 'old' ? l.oldN : l.newN, l, a)}
                <span className="diff-mark">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
                <Code text={l.text} lang={lang} />
              </div>
            ) : (
              <div className="diff-cell empty" />
            );
          return [
            <div key={i} className="diff-row">
              {cell(r.left, la, 'old')}
              {cell(r.right, ra, 'new')}
            </div>,
            thread(la, `l${i}`),
            thread(ra, `r${i}`),
          ];
        })}
      </div>
    );
  } else {
    body = (
      <div className="diff">
        {lines.flatMap((l, i) => {
          const a = anchorOf(l);
          return [
            <div key={i} className={`diff-row ${l.kind}${extra.has(l) ? ' extra' : ''}`}>
              {num(l.oldN, l, a?.side === 'LEFT' ? a : null)}
              {num(l.newN, l, a?.side === 'RIGHT' ? a : null)}
              <span className="diff-mark">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
              <Code text={l.text} lang={lang} />
            </div>,
            thread(a, `t${i}`),
          ];
        })}
      </div>
    );
  }

  const bar = (children: ReactNode) => <div className="diff-bar">{children}</div>;
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#FAFBFC', borderBottom: '1px solid var(--border)' }}>
        <PathLabel path={hunk.path} />
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {badge}
          {risks.map((r) => (
            <span key={r.code} className={`pill ${r.severity}`} style={{ fontSize: 11 }}>
              {r.label}
            </span>
          ))}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{hunk.rangeLabel}</span>
        </span>
      </div>
      {showNote && hunk.note && (
        // Before the code: it says what to look for while reading it.
        <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--accent-soft)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
            <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-body)', minWidth: 0 }}>
            <span className="label-sm">{noteBy === 'reviewer' ? 'Reviewer’s note' : 'Note from the agent'}</span>
            <Markdown text={hunk.note} />
          </div>
        </div>
      )}
      {!open ? (
        <button type="button" className="link diff-bar" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(true)}>
          {collapsed} Show it
        </button>
      ) : (
        <>
          {(canUp || canDown) &&
            bar(
              <>
                {canUp && (
                  <button type="button" className="link" disabled={loading} onClick={() => grow('up')}>
                    ↑ {STEP} more lines above
                  </button>
                )}
                <button type="button" className="link" disabled={loading} onClick={() => grow('all')}>
                  Whole file
                </button>
              </>
            )}
          <div style={{ overflowX: 'auto' }}>{body}</div>
          {!all && base.length > MAX_ROWS && (
            <button type="button" className="link diff-bar" style={{ width: '100%', textAlign: 'left' }} onClick={() => setAll(true)}>
              Show {base.length - MAX_ROWS} more lines
            </button>
          )}
          {canDown &&
            bar(
              <button type="button" className="link" disabled={loading} onClick={() => grow('down')}>
                ↓ {STEP} more lines below
              </button>
            )}
        </>
      )}
    </section>
  );
}

function LineComposer({ initial = '', onSave, onCancel }: { initial?: string; onSave: (body: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState(initial);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        autoFocus
        rows={2}
        className="textarea"
        aria-label="Comment on this line"
        placeholder="Comment on this line"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(body);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" style={{ height: 32 }} disabled={!body.trim() && !initial} onClick={() => onSave(body)}>
          {initial ? 'Save' : 'Comment'}
        </button>
        <button type="button" className="btn" style={{ height: 32 }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function LineComment({ comment, onSave }: { comment: Comment; onSave: (body: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (edit)
    return (
      <LineComposer
        initial={comment.body}
        onCancel={() => setEdit(false)}
        onSave={(b) => {
          onSave(b);
          setEdit(false);
        }}
      />
    );
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.5 }}>
      <span style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.body}</span>
      <button type="button" className="link" style={{ fontSize: 12.5 }} onClick={() => setEdit(true)}>
        Edit
      </button>
      <button type="button" className="link" style={{ fontSize: 12.5, color: 'var(--high-fg)' }} onClick={() => onSave('')}>
        Delete
      </button>
    </div>
  );
}
