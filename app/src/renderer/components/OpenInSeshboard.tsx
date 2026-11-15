// Seshboard shows a Claude Code session in full: the agent's whole conversation, as if you picked it in its sidebar.
import { useEffect, useState } from 'react';
import type { SessionInfo } from '../../shared/types.ts';
import { TextButton } from './ui/TextButton.tsx';

/** Asked once a run: installing Seshboard while Hunkdory runs shows the button after a restart. */
let installed: Promise<boolean> | null = null;

/** Opens the agent's session in Seshboard. Nothing when it's a Copilot session or Seshboard isn't installed. */
export function OpenInSeshboard({ session, className }: { session: SessionInfo; className?: string }) {
  const [there, setThere] = useState(false);
  useEffect(() => {
    let live = true;
    installed ??= window.api.seshboardInstalled().catch(() => false);
    installed.then((on) => live && setThere(on));
    return () => {
      live = false;
    };
  }, []);
  if (session.agent !== 'claude-code' || !there) return null;
  return (
    <TextButton className={className} onClick={() => void window.api.openExternal(`seshboard://session/${session.id}`)}>
      Open in Seshboard
    </TextButton>
  );
}
