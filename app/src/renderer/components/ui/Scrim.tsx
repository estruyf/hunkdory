/**
 * The dim layer behind a panel that covers part of the window (reading mode's session list). A click on it calls
 * `onClose`. `Dialog` has its own scrim for modals; this one is for panels that slide in from an edge.
 */
export function Scrim({ onClose, className = '', ...rest }: { onClose(): void; className?: string; [data: `data-${string}`]: unknown }) {
  return <div aria-hidden className={`no-drag absolute inset-0 bg-scrim ${className}`} onMouseDown={onClose} {...rest} />;
}
