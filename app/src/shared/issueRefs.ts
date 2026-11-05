// "#123" in text someone wrote: finding them, and turning them into links in rendered markdown.
import type { IssueRefs } from './types.ts';

/** Not in a word, a path, a URL's fragment or an HTML entity. Long enough for any real number, and short enough for GraphQL's Int. */
const REF = /(?<![\w/#&])#([1-9]\d{0,8})\b/g;
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+$/i;

/** The issues and PRs some text points at, in order of first mention. `closes`: a "Fixes #1" anywhere counts. */
export function findRefs(texts: (string | null | undefined)[], repoUrl: string): { number: number; closes: boolean }[] {
  const found = new Map<number, boolean>();
  const url = new RegExp(`${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:issues|pull)/([1-9]\\d{0,8})\\b`, 'g');
  for (const text of texts) {
    // What's in code is about code, as in `color: #123`.
    const prose = (text ?? '').replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const matches = [...prose.matchAll(REF), ...prose.matchAll(url)].sort((a, b) => a.index - b.index);
    for (const m of matches) {
      const n = Number(m[1]);
      found.set(n, !!found.get(n) || CLOSING.test(prose.slice(0, m.index)));
    }
  }
  return [...found].map(([number, closes]) => ({ number, closes }));
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  title?: string | null;
}

const STATE = { open: 'Open', closed: 'Closed', merged: 'Merged' };

/** A remark plugin: "#123" becomes a link with its title on hover, unless GitHub said there's no such number. */
export function issueLinks(refs: IssueRefs) {
  const known = new Map(refs.refs.map((r) => [r.number, r]));
  const missing = new Set(refs.missing);

  const split = (text: string): MdNode[] => {
    const out: MdNode[] = [];
    let at = 0;
    for (const m of text.matchAll(REF)) {
      const n = Number(m[1]);
      if (missing.has(n)) continue;
      if (m.index > at) out.push({ type: 'text', value: text.slice(at, m.index) });
      const ref = known.get(n);
      out.push({ type: 'link', url: ref?.url ?? `${refs.repoUrl}/issues/${n}`, title: ref ? `${ref.title} · ${STATE[ref.state]}` : null, children: [{ type: 'text', value: m[0] }] });
      at = m.index + m[0].length;
    }
    if (!out.length) return [{ type: 'text', value: text }];
    if (at < text.length) out.push({ type: 'text', value: text.slice(at) });
    return out;
  };

  const visit = (node: MdNode) => {
    if (!node.children || node.type === 'link' || node.type === 'linkReference') return;
    node.children = node.children.flatMap((c) => {
      if (c.type === 'text') return split(c.value ?? '');
      visit(c);
      return [c];
    });
  };
  return () => (tree: MdNode) => visit(tree);
}
