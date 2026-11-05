// Where you are and how to go elsewhere, for parts of the shell that aren't handed `go` (the header, ⌘P).
import { create } from 'zustand';
import type { Go, Route } from '../App.tsx';

export const useNav = create<{ go: Go; route: Route | null; settings: boolean; /** The tab strip is up: it has the traffic lights and the way back to the inbox. */ tabs: boolean }>()(() => ({ go: () => {}, route: null, settings: false, tabs: false }));

/** Settings opens over the view you're on and closes back to it, as Switchboard's Settings sheet does. */
export const openSettings = (on = true) => useNav.setState({ settings: on });
