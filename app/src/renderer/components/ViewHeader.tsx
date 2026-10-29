import type { ReactNode } from 'react';
import { SidebarToggle } from './sidebar/SidebarToggle.tsx';

/**
 * The top of every view, as in Switchboard: 52px, drags the window, the sidebar toggle first, then the
 * view's title or crumbs and its actions. Controls in it take clicks (styles.css).
 */
export function ViewHeader({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <header className={`drag flex h-13 shrink-0 items-center gap-2 border-b border-border px-4 ${className}`}>
      <SidebarToggle />
      {children}
    </header>
  );
}
