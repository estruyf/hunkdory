// What the shortcuts sheet shows: the registry by section, filtered by words or by keys you press, laid out
// in two columns. Pure, so it can be tested without React. Switchboard's sheet works the same way.
import { SECTION_TITLES, SHORTCUTS, available, formatKeys, normalizeShortcut, shortcutFromEvent, type ShortcutContext, type ShortcutDef, type ShortcutSection } from '../../lib/shortcuts.ts';

export type SheetMode = 'all' | 'here';

export interface SheetRow {
  id: string;
  action: string;
  context?: string;
  note?: string;
  keys: readonly string[];
  available: boolean;
  /** Which of `keys` the filter matched, drawn in the accent. */
  marked: number[];
}

export interface SheetSection {
  id: ShortcutSection;
  title: string;
  rows: SheetRow[];
}

/** A key press typed into the filter (⌘J looks ⌘J up instead of doing it); null for plain typing. */
export function typedCombo(event: KeyboardEvent): string | null {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  return shortcutFromEvent(event);
}

const words = (def: ShortcutDef) => `${def.action} ${def.context ?? ''} ${def.note ?? ''} ${SECTION_TITLES[def.section]}`.toLowerCase();

export function sheetLayout({ ctx, mode, query }: { ctx: ShortcutContext; mode: SheetMode; query: string }): { columns: SheetSection[][]; count: number } {
  const q = query.trim().toLowerCase();
  // A pressed combo ("cmd+j") matches keys; anything else matches words, or keys as they are written (⌘J).
  const combo = q.includes('+') ? normalizeShortcut(q) : null;
  const sections = new Map<ShortcutSection, SheetRow[]>();
  for (const def of SHORTCUTS as readonly ShortcutDef[]) {
    const works = available(def, ctx);
    if (mode === 'here' && !works) continue;
    const marked = def.keys.flatMap((k, i) => (q && (combo ? normalizeShortcut(k) === combo : formatKeys(k).toLowerCase().includes(q)) ? [i] : []));
    if (q && !marked.length && !words(def).includes(q)) continue;
    const list = sections.get(def.section) ?? [];
    list.push({ id: def.id, action: def.action, context: def.context, note: def.note, keys: def.keys, available: works, marked });
    sections.set(def.section, list);
  }
  const all = [...sections].map(([id, rows]) => ({ id, title: SECTION_TITLES[id], rows }));
  // Two columns of about the same height, sections kept whole and in order.
  const total = all.reduce((n, s) => n + s.rows.length + 2, 0);
  const left: SheetSection[] = [];
  const right: SheetSection[] = [];
  let height = 0;
  for (const s of all) {
    (height < total / 2 ? left : right).push(s);
    height += s.rows.length + 2;
  }
  return { columns: [left, right], count: all.reduce((n, s) => n + s.rows.length, 0) };
}
