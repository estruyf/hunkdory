import { Search } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ShortcutContext } from '../../lib/shortcuts.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { Kbd, KeyCombo } from '../ui/Kbd.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { sheetLayout, typedCombo, type SheetMode, type SheetRow, type SheetSection } from './shortcutSheet.ts';

/**
 * The keyboard shortcuts sheet (⌘/): every shortcut from the registry in `lib/shortcuts.ts`, as in Switchboard.
 * Rows that don't work where you are stay visible but faded (All) or go away (Here). The filter matches words
 * and keys, and a combo pressed in it is typed instead of run.
 */
export function ShortcutsSheet({ ctx, onClose }: { ctx: ShortcutContext; onClose(): void }) {
  const [mode, setMode] = useState<SheetMode>('all');
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => sheetLayout({ ctx, mode, query }), [ctx, mode, query]);

  const rows = () => [...(body.current?.querySelectorAll<HTMLElement>('[data-shortcut-row]') ?? [])];
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const combo = typedCombo(event.nativeEvent);
    if (combo) {
      event.preventDefault();
      event.stopPropagation();
      setQuery(combo);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const list = rows();
      if (!list.length) return;
      event.preventDefault();
      (event.key === 'ArrowDown' ? list[0] : list.at(-1))!.focus();
    }
  };
  // ↑ and ↓ read through the rows; ↑ from the first goes back to the field; typing goes on in the filter.
  const onRowsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = rows();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = index + step;
      if (next < 0) input.current?.focus();
      else list[Math.min(next, list.length - 1)]!.focus();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setQuery((q) => q + event.key);
      input.current?.focus();
    }
  };

  const empty = layout.count === 0 && query.trim() !== '';
  return (
    <Dialog
      title="Keyboard shortcuts"
      width="sheet"
      placement="top"
      flush
      onClose={onClose}
      initialFocus={input}
      headerActions={
        <>
          <label className="relative flex items-center">
            <Search size={13} aria-hidden className="pointer-events-none absolute left-2 text-faint" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFieldKey}
              placeholder="Filter by action or key"
              aria-label="Filter by action or key"
              spellCheck={false}
              className="h-7 w-64 rounded-md border border-edge bg-bg pr-2 pl-7 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60"
            />
          </label>
          <SegmentedControl<SheetMode>
            mode="radio"
            label="Which shortcuts"
            value={mode}
            onChange={setMode}
            segments={[
              { value: 'all', label: 'All', tooltip: 'Every shortcut; the ones that don’t work here are faded' },
              { value: 'here', label: 'Here', tooltip: 'Only what works where you are' },
            ]}
            className="mx-1"
          />
        </>
      }
      footerStart={<span className="text-meta text-muted">Faded rows don't work where you are right now.</span>}
      footer={
        <span className="flex items-center gap-1.5 text-meta text-muted">
          <Kbd keys="Esc" /> close
        </span>
      }
    >
      <div ref={body} className="px-5 py-4" onKeyDown={onRowsKey}>
        {empty ? (
          <div className="py-10 text-center text-ui">
            <p className="text-text">No shortcut for “{query.trim()}”</p>
            <p className="mt-1 text-muted">Try another word, or press the keys you're after.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8">
            {layout.columns.map((sections, column) => (
              <div key={column} className="flex min-w-0 flex-col gap-5">
                {sections.map((section) => (
                  <Section key={section.id} section={section} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Section({ section }: { section: SheetSection }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-1.5 px-2">
        <SectionHeader as="h3" headingId={headingId}>
          {section.title}
        </SectionHeader>
      </div>
      <ul aria-labelledby={headingId}>
        {section.rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row }: { row: SheetRow }) {
  return (
    <li tabIndex={-1} className={`flex items-center gap-3 rounded-md px-2 py-1.5 outline-none focus-visible:bg-border/45 ${row.available ? '' : 'opacity-40'}`} data-shortcut-row={row.id}>
      <span className="min-w-0 flex-1">
        <span className="block text-ui text-text">{row.action}</span>
        {(row.context || row.note) && (
          <span className="block text-meta text-muted">
            {row.context}
            {row.context && row.note && ' · '}
            {row.note}
          </span>
        )}
        {!row.available && <span className="sr-only">, not available here</span>}
      </span>
      <KeyCombo combos={row.keys} marked={row.marked} className="shrink-0" />
    </li>
  );
}
