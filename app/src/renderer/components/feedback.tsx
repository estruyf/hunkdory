import { useAsync } from './ui.tsx';
import { feedbackUrl } from '../../shared/feedback.ts';

/** The version you're on and the way to say something about it, at the foot of a page. */
export function VersionLine() {
  const info = useAsync(() => window.api.appInfo(), []);
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-meta text-faint">
      <span>Hunkdory {info.value?.version ?? ''}</span>
      <span aria-hidden>·</span>
      <button type="button" className="text-link hover:underline" data-tooltip="Opens a new issue on GitHub with your version filled in. Nothing is sent until you submit it." onClick={() => window.api.openExternal(feedbackUrl(info.value ?? null))}>
        Send feedback ↗
      </button>
    </p>
  );
}
