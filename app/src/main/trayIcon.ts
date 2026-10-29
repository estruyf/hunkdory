// The Hunkdory mark (three diff lines and a check) drawn as a macOS template image,
// so the menu bar icon needs no image assets.
import { nativeImage, type NativeImage } from 'electron';

type Seg = [number, number, number, number];

// Same geometry as the app icon, in a 24x24 viewBox: three diff lines, then the check.
const BARS: Seg[] = [
  [4.5, 6, 10.5, 6],
  [4.5, 10.5, 15, 10.5],
  [4.5, 15, 9.5, 15],
];
const CHECK: Seg[] = [
  [13.5, 16.5, 16, 19],
  [16, 19, 21, 13],
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
