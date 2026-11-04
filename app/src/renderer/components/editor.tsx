// "Open in VS Code" (or whichever editor you use) for the folder a branch is checked out in.
import { SquareArrowOutUpRight } from 'lucide-react';
import { useState } from 'react';
import type { ReviewData } from '../../shared/types.ts';
import { cleanError, useAsync } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import type { ButtonSize } from './ui/buttonStyles.ts';

/** Opens the branch's folder in your editor; Finder when no editor is installed. Only for a branch that's checked out. */
export function OpenInEditor({ data, size = 'sm' }: { data: ReviewData; size?: ButtonSize }) {
  const editors = useAsync(() => window.api.editors(), []);
  const [error, setError] = useState<string | null>(null);
  const name = editors.value?.current?.name;
  const open = async () => {
    setError(null);
    try {
      await window.api.openInEditor(data.projectId, data.branch);
    } catch (e) {
      setError(cleanError(e));
    }
  };
  return (
    <>
      <Button size={size} variant="quiet" icon={<SquareArrowOutUpRight size={13} aria-hidden />} onClick={open} data-tooltip={name ? 'Opens the folder Claude works in. Pick the editor in Settings.' : 'No editor found in Applications: opens the folder in Finder.'}>
        {name ? `Open in ${name}` : 'Show in Finder'}
      </Button>
      {/* Said next to the button: a click that does nothing reads as broken. */}
      {error && (
        <span role="alert" className="text-meta text-error">
          {error}
        </span>
      )}
    </>
  );
}
