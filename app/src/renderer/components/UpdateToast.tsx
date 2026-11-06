// News about a new version of Hunkdory, over every screen, from "is available" through "Restart to update".
import { ArrowDownCircle, CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './ui/Button.tsx';
import { useUpdate } from '../state/update.ts';
import { updateToast, type UpdateToast as Toast } from '../../shared/update.ts';

/** How long "Updated to …" stays before it counts as seen. */
const UPDATED_MS = 10_000;

const LEAD: Record<Toast['tone'], ReactNode> = {
  accent: <ArrowDownCircle size={14} className="shrink-0 text-accent-ink" aria-hidden />,
  busy: <LoaderCircle size={14} className="shrink-0 animate-spin text-accent-ink" aria-hidden />,
  error: <CircleAlert size={14} className="shrink-0 text-error" aria-hidden />,
  ok: <CheckCircle2 size={14} className="shrink-0 text-ok" aria-hidden />,
};

function Progress({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent-ink transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-meta tabular-nums">{percent}%</span>
    </div>
  );
}

function Card({ toast, onClose }: { toast: Toast; onClose(): void }) {
  const [showNotes, setShowNotes] = useState(false);
  useEffect(() => {
    if (toast.tone !== 'ok') return;
    const timer = setTimeout(onClose, UPDATED_MS);
    return () => clearTimeout(timer);
  }, [toast.key]);
  const closeLabel = toast.close === 'dismiss' ? 'Dismiss' : 'Not now';
  return (
    <div
      role="status"
      // A focused toast takes Escape itself, so it never reaches the screen under it.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      data-update-toast={toast.key}
      className="flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-xl border overlay py-2.5 pr-2 pl-3.5 text-ui text-text"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {LEAD[toast.tone]}
        <span className="min-w-0 flex-1 truncate font-semibold">{toast.title}</span>
        <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label={closeLabel} onClick={onClose} className="shrink-0" />
      </div>
      {toast.progress !== null ? (
        <div className="pr-2 text-muted">
          <Progress percent={toast.progress} />
        </div>
      ) : (
        // Errors can carry a long URL or path with no spaces: let it wrap anywhere rather than run out of the card.
        toast.body && <div className="pr-2 text-muted [overflow-wrap:anywhere]">{toast.body}</div>
      )}
      {(toast.action || toast.notes) && (
        <div className="mt-1 flex items-center gap-2">
          {toast.action && (
            <Button variant="primary" onClick={() => void window.api.runUpdate(toast.action!.run)} data-update-action={toast.action.run}>
              {toast.action.label}
            </Button>
          )}
          {toast.notes && (
            <Button onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
              What’s new
            </Button>
          )}
        </div>
      )}
      {showNotes && toast.notes && (
        <p className="mt-1 max-h-56 overflow-y-auto pr-2 leading-relaxed whitespace-pre-wrap text-muted" tabIndex={0}>
          {toast.notes}
        </p>
      )}
    </div>
  );
}

/** Closing an offer hides it until the next step or the next launch; closing "Updated" tells main it was seen. */
export function UpdateToast() {
  const state = useUpdate((s) => s.state);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const toast = updateToast(state);
  if (!toast || hidden.has(toast.key)) return null;
  const close = () => {
    if (toast.close === 'dismiss') void window.api.runUpdate('dismiss');
    else setHidden((keys) => new Set(keys).add(toast.key));
  };
  return (
    <div className="fixed right-4 bottom-4 z-70">
      <Card key={toast.key} toast={toast} onClose={close} />
    </div>
  );
}
