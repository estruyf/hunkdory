// What each project shows as its icon. Read together, since the inbox, the tabs and Settings all draw them.
import { create } from 'zustand';
import type { ProjectIconInfo } from '../../shared/types.ts';

export const useProjectIcons = create<{ icons: Record<string, ProjectIconInfo> }>(() => ({ icons: {} }));

export const loadProjectIcons = () => window.api.projectIcons().then((icons) => useProjectIcons.setState({ icons }), () => {});
