/**
 * The platform Hunkdory runs on, from the preload (`process.platform`). macOS when there is no window, as in
 * unit tests, so what they check stays the macOS wording. Read when called, never at load.
 */
export function currentPlatform(): string {
  return (typeof window !== 'undefined' && window.frame?.platform) || 'darwin';
}

/** What the file manager is called: Finder, File Explorer, or Files on Linux. */
export const fileManagerName = (platform = currentPlatform()) => (platform === 'win32' ? 'File Explorer' : platform === 'darwin' ? 'Finder' : 'Files');

/** Where deleted files go: the Trash, or the Recycle Bin on Windows. */
export const trashName = (platform = currentPlatform()) => (platform === 'win32' ? 'Recycle Bin' : 'Trash');

/** How to get a file back from there: from Finder on macOS, from the Recycle Bin itself on Windows. */
export const restoreFrom = (platform = currentPlatform()) => (platform === 'darwin' ? 'from Finder' : 'from there');

/** This computer, next to the paired ones (the Computers strip, Run on): "This Mac", or "This PC" on Windows. */
export const thisComputerName = (platform = currentPlatform()) => (platform === 'darwin' ? 'This Mac' : 'This PC');
