import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeTooltip, placeTooltipRight } from './tooltipPlacement.ts';

/** How long the pointer rests on a target before its tooltip shows. Exported for tooltips drawn by their own component (the prompt outline). */
export const SHOW_DELAY = 450;
/** Moving from one tooltip target to the next within this window shows the next one at once. */
export const WARM_WINDOW = 400;

interface Shown {
  text: string;
  target: Element;
  /** Set when the target describes a card (`data-tooltip-title`), as the minimal sidebar's rows do. */
  card: TooltipCard | null;
  right: boolean;
}

/** The status colours a card's status line can take. */
const TONE_TEXT: Record<string, string> = { warn: 'text-warn', accent: 'text-accent-ink', unread: 'text-unread', ok: 'text-ok', error: 'text-error', faint: 'text-muted' };
const TONE_DOT: Record<string, string> = { warn: 'bg-warn', accent: 'bg-accent-ink', unread: 'bg-unread', ok: 'bg-ok', error: 'bg-error', faint: 'bg-faint' };

interface TooltipCard {
  title: string;
  meta: string | null;
  status: string | null;
  tone: string | null;
  hint: string | null;
}

function readCard(target: Element): TooltipCard | null {
  const title = target.getAttribute('data-tooltip-title');
  if (!title) return null;
  return {
    title,
    meta: target.getAttribute('data-tooltip-meta'),
    status: target.getAttribute('data-tooltip-status'),
    tone: target.getAttribute('data-tooltip-tone'),
    hint: target.getAttribute('data-tooltip-hint'),
  };
}

/**
 * Themed tooltips in place of the slow, unthemed macOS `title` tooltip. Mount once; any element with
 * `data-tooltip="…"` gets one on hover or keyboard focus. One delegated listener covers virtualised
 * rows too. The attribute is not an accessible name: icon-only buttons also need an `aria-label`.
 *
 * `data-tooltip-placement="right"` puts it beside the target instead of below. A target can also
 * describe a small card: `data-tooltip-title`, then `data-tooltip-meta`, a status line in a status
 * colour (`data-tooltip-status`, `data-tooltip-tone`: warn, accent, unread, ok, error, faint) and a
 * faint hint (`data-tooltip-hint`). `data-tooltip` stays the plain text of the same.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    let hiddenAt = 0;

    const hide = () => {
      clearTimeout(timer);
      if (current) hiddenAt = Date.now();
      current = null;
      setShown(null);
    };
    const show = (target: Element) => {
      const text = target.getAttribute('data-tooltip');
      if (!text) return hide();
      if (target === current) return;
      clearTimeout(timer);
      const warm = current !== null || Date.now() - hiddenAt < WARM_WINDOW;
      current = target;
      setShown(null);
      timer = setTimeout(
        () => current === target && target.isConnected && setShown({ text, target, card: readCard(target), right: target.getAttribute('data-tooltip-placement') === 'right' }),
        warm ? 0 : SHOW_DELAY,
      );
    };

    const onOver = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.('[data-tooltip]');
      if (target) show(target);
      else if (current) hide();
    };
    const onFocus = (event: FocusEvent) => {
      // Only keyboard focus shows a tooltip; a click focusing a button shouldn't.
      if (!document.documentElement.hasAttribute('data-keyboard-nav')) return;
      onOver(event);
    };
    const onFocusOut = (event: FocusEvent) => event.target === current && hide();
    // Only a scroll around the target moves it. A conversation that keeps to its end while Claude writes
    // must not drop the tooltip of a button in the sidebar.
    const onScroll = (event: Event) => {
      const scroller = event.target;
      if (current && (scroller === document || (scroller instanceof Node && scroller.contains(current)))) hide();
    };
    const onLeaveWindow = (event: MouseEvent) => event.relatedTarget === null && hide();

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mouseout', onLeaveWindow);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mouseout', onLeaveWindow);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return setPosition(null);
    const rect = shown.target.getBoundingClientRect();
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPosition(shown.right ? placeTooltipRight(rect, size, viewport) : placeTooltip(rect, size, viewport));
  }, [shown]);

  if (!shown) return null;
  const { card } = shown;
  if (card) {
    return (
      <div
        ref={ref}
        role="tooltip"
        style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
        className="pointer-events-none fixed z-[100] grid max-w-[340px] gap-0.5 rounded-lg border overlay px-3 py-2 text-meta leading-snug text-text wrap-anywhere"
        data-tooltip-layer
        data-tooltip-card
      >
        <span className="flex items-center gap-2 text-ui font-semibold">
          {card.tone && <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[card.tone] ?? 'bg-faint'}`} />}
          <span className="min-w-0">{card.title}</span>
        </span>
        {card.meta && <span className="text-muted">{card.meta}</span>}
        {card.status && <span className={`mt-0.5 font-medium ${TONE_TEXT[card.tone ?? ''] ?? 'text-muted'}`}>{card.status}</span>}
        {card.hint && <span className="mt-0.5 text-faint">{card.hint}</span>}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      className="pointer-events-none fixed z-[100] max-w-[320px] rounded-md border overlay px-2 py-1 text-[11.5px] leading-snug whitespace-pre-line text-text wrap-anywhere"
      data-tooltip-layer
    >
      {shown.text}
    </div>
  );
}
