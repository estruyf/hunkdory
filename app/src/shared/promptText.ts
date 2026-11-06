// A prompt as the plan shows it: a short plain preview, with long links you can still read. Pure.

export type PromptPart = { text: string } | { url: string; label: string };

/** A URL shorter than this reads fine as it is. */
const LONG_URL = 48;
const LOCALE = /^[a-z]{2}(-[a-z]{2,4})?$/i;
/** Ids and hashes say nothing to someone reading. */
const OPAQUE = /^[0-9a-f-]{16,}$|^.{33,}$/i;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** "learn.microsoft.com › microsoft-365 › search › overview": the host, then the first and the last parts of the path. */
export function shortUrl(url: string): string {
  if (url.length <= LONG_URL) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!/^https?:$/.test(parsed.protocol)) return url;
  const path = parsed.pathname.split('/').filter(Boolean).map(decode).filter((s) => !LOCALE.test(s) && !OPAQUE.test(s));
  const key = path.length > 3 ? [path[0], ...path.slice(-2)] : path;
  return [parsed.hostname.replace(/^www\./, ''), ...key].join(' › ');
}

/** Markdown's marks, so the preview reads as text. Links stay as bare URLs: the parts pick those up. */
function toPlain(text: string): string {
  return text
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The text and the links in it, with a URL's trailing punctuation left to the sentence. */
function toParts(text: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let at = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ url, label: shortUrl(url) });
    at = m.index + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/**
 * The first `clamp` characters of a prompt as plain text, ending on a whole word. A link counts as
 * what it shows, not as its URL, and is never cut. `cut` says there's more to show.
 */
export function promptPreview(prompt: string, clamp: number): { parts: PromptPart[]; cut: boolean } {
  const parts: PromptPart[] = [];
  let left = clamp;
  for (const part of toParts(toPlain(prompt))) {
    const size = 'url' in part ? part.label.length : part.text.length;
    if (size <= left) {
      parts.push(part);
      left -= size;
      continue;
    }
    if ('text' in part) {
      const room = part.text.slice(0, left);
      const word = room.lastIndexOf(' ');
      const kept = (word > 0 ? room.slice(0, word) : room).trimEnd();
      if (kept) parts.push({ text: kept });
    }
    const last = parts.at(-1);
    if (last && 'text' in last) parts[parts.length - 1] = { text: `${last.text.trimEnd()}…` };
    else parts.push({ text: '…' });
    return { parts, cut: true };
  }
  return { parts, cut: false };
}
