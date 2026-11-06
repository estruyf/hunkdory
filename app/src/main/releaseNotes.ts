/** Release notes longer than this are cut (at a line break when there is one) and end with "…". */
export const RELEASE_NOTES_LIMIT = 3000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower]!;
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : lower.startsWith('#') ? Number.parseInt(lower.slice(1), 10) : Number.NaN;
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
  });
}

/** GitHub's release feed gives HTML; keep the structure (headings, list items, paragraphs) as plain text. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<h[1-6]\b[^>]*>/gi, '\n\n')
      .replace(/<\/(h[1-6]|p|ul|ol|div|blockquote|pre)>/gi, '\n\n')
      .replace(/<[^>]*>/g, ''),
  );
}

/** Markdown reads fine as text without its emphasis and link syntax. */
function simplifyMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^[ \t]*[*+][ \t]+/gm, '- ');
}

/**
 * Turns whatever electron-updater reports as release notes (an HTML or Markdown string, or a list of
 * `{ version, note }`) into short plain text. Anything unusable gives null, never an error: bad notes must not block
 * an update.
 */
export function cleanReleaseNotes(raw: unknown, limit = RELEASE_NOTES_LIMIT): string | null {
  try {
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (Array.isArray(raw)) {
      text = raw
        .map((entry: unknown) => {
          const { version, note } = (entry ?? {}) as { version?: unknown; note?: unknown };
          return typeof note === 'string' && note.trim() ? `${typeof version === 'string' ? `${version}\n\n` : ''}${note}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
    } else return null;

    const plain = simplifyMarkdown(/<[a-z][\s\S]*>/i.test(text) ? htmlToText(text) : text)
      .replace(/\r\n?/g, '\n')
      // Control characters (other than newlines and tabs) have no business in notes.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!plain) return null;
    if (plain.length <= limit) return plain;
    const cut = plain.slice(0, limit);
    const lineBreak = cut.lastIndexOf('\n');
    return `${(lineBreak > limit * 0.6 ? cut.slice(0, lineBreak) : cut).trimEnd()}\n…`;
  } catch {
    return null;
  }
}
