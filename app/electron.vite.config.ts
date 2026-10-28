import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const wtv = resolve(__dirname, '../tools/wtv/src');

export default defineConfig({
  main: {
    // wtv is bundled into the main and worker chunks so the packaged app doesn't need it on disk.
    resolve: { alias: { '@wtv': wtv } },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
