// The Hunkdory mark (three diff lines and a check) drawn as a macOS template image,
// so the menu bar icon needs no image assets.
import { nativeImage, type NativeImage } from 'electron';

type Seg = [number, number, number, number];

// Same geometry as the app icon, in a 24x24 viewBox: its three diff lines, then the check.
const BARS: Seg[] = [
  [5.2, 5.8, 15.5, 5.8],
  [5.2, 9.8, 18.8, 9.8],
  [5.2, 13.7, 10.4, 13.7],
];
const CHECK: Seg[] = [
  [12.8, 17.2, 15.6, 20],
  [15.6, 20, 20.7, 13.6],
];
const SEGMENTS = [...BARS, ...CHECK];

function distToSeg(px: number, py: number, [x1, y1, x2, y2]: Seg) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function trayIcon(): NativeImage {
  const size = 32; // 16pt at 2x
  const scale = size / 24;
  const half = 1.25; // stroke half-width in viewBox units: round-capped bars that stay crisp at 16pt
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const d = Math.min(...SEGMENTS.map((s) => distToSeg(px, py, s)));
      const alpha = Math.max(0, Math.min(1, (half - d) * scale + 0.5));
      buf[(y * size + x) * 4 + 3] = Math.round(alpha * 255); // BGRA, black with alpha
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}
