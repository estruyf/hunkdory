// The in-app updater, which lives in the main process: this store keeps up with it, for the toast and Settings.
import { create } from 'zustand';
import type { UpdateState } from '../../shared/update.ts';

export const useUpdate = create<{ state: UpdateState | null }>()(() => ({ state: null }));

/** Follows the updater until the returned function is called. */
export function watchUpdate(): () => void {
  void window.api.updateState().then((state) => useUpdate.setState({ state }));
  return window.events.onUpdateChanged((state) => useUpdate.setState({ state }));
}
