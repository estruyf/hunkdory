// The Reviewer mark (magnifier with a check) drawn as a macOS template image,
// so the menu bar icon needs no image assets.
import { nativeImage, type NativeImage } from 'electron';

type Seg = [number, number, number, number];

// Same geometry as the logo in the design, in a 24x24 viewBox.
const RING = { cx: 11, cy: 11, r: 7 };
const SEGMENTS: Seg[] = [
  [16.7, 16.7, 21, 21],
  [8, 11, 10, 13],
  [10, 13, 14, 9],
];

function distToSeg(px: number, py: number, [x1, y1, x2, y2]: Seg) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function trayIcon(): NativeImage {
  const size = 32; // 16pt at 2x
  const scale = size / 24;
  const half = 1.15; // stroke half-width in viewBox units, a touch heavier than the logo for the menu bar
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const d = Math.min(Math.abs(Math.hypot(px - RING.cx, py - RING.cy) - RING.r), ...SEGMENTS.map((s) => distToSeg(px, py, s)));
      const alpha = Math.max(0, Math.min(1, (half - d) * scale + 0.5));
      buf[(y * size + x) * 4 + 3] = Math.round(alpha * 255); // BGRA, black with alpha
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}
