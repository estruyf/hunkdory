import hljs from 'highlight.js/lib/common';
import { createContext, isValidElement, useContext, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGemoji from 'remark-gemoji';
import remarkGfm from 'remark-gfm';
import { codeLanguage } from '../../shared/diff.ts';
import { issueLinks } from '../../shared/issueRefs.ts';
import type { IssueRefs } from '../../shared/types.ts';

const open = (href: string | undefined) => {
  if (href && /^https:\/\//.test(href)) window.api.openExternal(href);
};

// Links open in the browser. Images can't load here (the page only allows its own), so they become links too.
const components: Components = {
  a: ({ href, title, children }) => (
    <a
      href={href}
      data-tooltip={title}
      onClick={(e) => {
        e.preventDefault();
        open(href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <a
      href={typeof src === 'string' ? src : undefined}
      onClick={(e) => {
        e.preventDefault();
        open(typeof src === 'string' ? src : undefined);
      }}
    >
      Image{alt ? `: ${alt}` : ''} ↗
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

/** How long a block can be and still get colour: highlighting a huge paste isn't worth the wait. */
const MAX_HIGHLIGHT = 100_000;

function highlighted(text: string, lang: string | null): string | null {
  if (!lang || !hljs.getLanguage(lang) || text.length > MAX_HIGHLIGHT) return null;
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

/** A fenced code block. Inline code never gets here: only a block is wrapped in a `pre`. */
function CodeBlock({ path, children }: { path?: string; children?: ReactNode }) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : null;
  const text = typeof code?.children === 'string' ? code.children : '';
  const fence = code?.className?.match(/language-(\S+)/)?.[1] ?? null;
  const html = useMemo(() => highlighted(text, codeLanguage(fence, path)), [text, fence, path]);
  // highlight.js escapes the text; its output is only its own spans.
  return <pre>{html === null ? children : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>;
}

/** What "#123" means on this screen. Without it, stays plain text. */
export const IssueRefsContext = createContext<IssueRefs | null>(null);

/**
 * GitHub-flavoured markdown from a PR description or prompt. Raw HTML is dropped, never rendered.
 * `path` is the file it's about, like a review comment's, for the code blocks that don't name a language.
 */
export function Markdown({ text, path }: { text: string; path?: string }) {
  const withCode = useMemo<Components>(() => ({ ...components, pre: ({ children }) => <CodeBlock path={path}>{children}</CodeBlock> }), [path]);
  const refs = useContext(IssueRefsContext);
  const plugins = useMemo(() => [remarkGfm, remarkGemoji, remarkBreaks, ...(refs ? [issueLinks(refs)] : [])], [refs]);
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={plugins} components={withCode} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
