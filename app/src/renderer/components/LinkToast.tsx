// A hunkdory:// link that didn't open a review: why not, or a folder you can add as a project.
import { CircleAlert, FolderPlus, X } from 'lucide-react';
import { Button } from './ui/Button.tsx';
import { useNav } from '../state/nav.ts';
import { useLinkNotice } from '../state/links.ts';

export function LinkToast() {
  const notice = useLinkNotice((s) => s.notice);
  if (!notice) return null;
  const close = () => useLinkNotice.setState({ notice: null });
  const add = notice.kind === 'not-a-project';
  return (
    <div
      role="status"
      // A focused toast takes Escape itself, so it never reaches the screen under it.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      className="flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-xl border overlay py-2.5 pr-2 pl-3.5 text-ui text-text"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {add ? <FolderPlus size={14} className="shrink-0 text-accent-ink" aria-hidden /> : <CircleAlert size={14} className="shrink-0 text-error" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-semibold">{add ? 'Not one of your projects' : 'Hunkdory didn’t open that link'}</span>
        <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Dismiss" onClick={close} className="shrink-0" />
      </div>
      {/* A path can be long with no spaces: let it wrap anywhere rather than run out of the card. */}
      <div className="pr-2 text-muted [overflow-wrap:anywhere]">{add ? <>A link asked for a review in <span className="font-mono">{notice.path}</span>, which isn’t a project in Hunkdory.</> : notice.reason}</div>
      {add && (
        <div className="mt-1 flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              close();
              useNav.getState().go({ name: 'connect', path: notice.path });
            }}
          >
            Add project
          </Button>
        </div>
      )}
    </div>
  );
}
