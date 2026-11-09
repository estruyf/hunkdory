// The computer Hunkdory runs on, in a sentence. Pure: the main process passes process.platform, the page its own
// (renderer/lib/platform.ts).

/** "this Mac", or "this PC" on Windows. */
export const thisComputer = (platform: string) => (platform === 'darwin' ? 'this Mac' : 'this PC');

/** "your Mac", or "your PC" on Windows. */
export const yourComputer = (platform: string) => (platform === 'darwin' ? 'your Mac' : 'your PC');
