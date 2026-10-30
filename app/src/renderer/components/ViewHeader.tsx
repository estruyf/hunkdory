import { House } from 'lucide-react';
import type { ReactNode } from 'react';
import { currentPlatform } from '../lib/platform.ts';
import { useNav } from '../state/nav.ts';
import { Button } from './ui/Button.tsx';

/**
 * The top of every view, as in Switchboard: 52px, drags the window, clears the traffic lights on macOS, then
 * the view's title or crumbs and its actions. Away from the inbox it starts with Inbox, which takes you back.
 * Controls in it take clicks (styles.css).
 */
export function ViewHeader({ children, className = '' }: { children?: ReactNode; className?: string }) {
  const route = useNav((s) => s.route?.name);
  const settings = useNav((s) => s.settings);
  const go = useNav((s) => s.go);
  const lights = currentPlatform() === 'darwin' ? 'pl-24' : 'pl-4';
  return (
    <header className={`drag flex h-13 shrink-0 items-center gap-2 border-b border-border pr-4 ${lights} ${className}`}>
      {route && route !== 'home' && !settings && (
        <Button variant="quiet" icon={<House size={14} aria-hidden />} shortcut="home" onClick={() => go({ name: 'home' })} data-tooltip="Back to the inbox. Your place in a review is kept.">
          Inbox
        </Button>
      )}
      {children}
    </header>
  );
}
