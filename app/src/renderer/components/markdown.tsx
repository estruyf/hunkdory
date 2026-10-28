import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const open = (href: string | undefined) => {
  if (href && /^https:\/\//.test(href)) window.api.openExternal(href);
};

// Links open in the browser. Images can't load here (the page only allows its own), so they become links too.
const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
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

/** GitHub-flavoured markdown from a PR description or prompt. Raw HTML is dropped, never rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
