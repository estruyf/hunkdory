import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Channels per pixel for each PNG colour type: grey, RGB, palette, grey and alpha, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Larger images are refused before inflating, so a hostile file can't ask for gigabytes of pixels. */
const MAX_PIXELS = 8192 * 8192;

/** Pixels as RGBA, 8 bits a channel, row after row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Decodes a PNG to RGBA. Every colour type and bit depth, without interlacing (Adam7), which icons rarely
 * use; null for that and for anything that isn't a well-formed PNG.
 */
export function decodePng(bytes: Uint8Array): Pixels | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at + 12 <= buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const name = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (body.length !== length) return null;
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      type = body[9]!;
      // Compression and filter method 0 are the only ones defined; interlaced images aren't handled.
      if (body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return null;
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') transparency = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  const channels = CHANNELS[type];
  if (!channels || !width || !height || width * height > MAX_PIXELS || ![1, 2, 4, 8, 16].includes(depth) || !idat.length) return null;
  if (type === 3 && !palette) return null;
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  // The filters look this many bytes back: one pixel, or one byte below 8 bits a pixel.
  const step = Math.max(1, bitsPerPixel >> 3);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (stride + 1)) return null;

  const out = new Uint8Array(width * height * 4);
  const max = (1 << Math.min(depth, 8)) - 1;
  // A sample's value at `index` (in samples from the row's start), scaled to 0–255; 16-bit keeps its high byte.
  const sample = (row: Buffer, index: number) => {
    if (depth === 8) return row[index]!;
    if (depth === 16) return row[index * 2]!;
    const bit = index * depth;
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max;
  };
  const scale = (value: number) => (type === 3 || depth >= 8 ? value : Math.round((value * 255) / max));
  // tRNS for grey and RGB names one colour that is transparent, in the image's own bit depth.
  const key = transparency && (type === 0 || type === 2) ? Array.from({ length: type === 0 ? 1 : 3 }, (_, i) => transparency!.readUInt16BE(i * 2)) : null;
  const rawSample = (row: Buffer, index: number) => (depth === 16 ? row.readUInt16BE(index * 2) : depth === 8 ? row[index]! : sample(row, index));

  let previous: Buffer = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    const row = raw.subarray(start + 1, start + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= step ? row[i - step]! : 0;
      const up = previous[i]!;
      const upLeft = i >= step ? previous[i - step]! : 0;
      let add: number;
      if (filter === 0) add = 0;
      else if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else return null;
      row[i] = (row[i]! + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (type === 3) {
        const index = sample(row, x);
        if (index * 3 + 2 >= palette!.length) return null;
        out[o] = palette![index * 3]!;
        out[o + 1] = palette![index * 3 + 1]!;
        out[o + 2] = palette![index * 3 + 2]!;
        out[o + 3] = transparency && index < transparency.length ? transparency[index]! : 255;
      } else if (type === 0 || type === 4) {
        const grey = scale(sample(row, s));
        out[o] = out[o + 1] = out[o + 2] = grey;
        out[o + 3] = type === 4 ? sample(row, s + 1) : key && rawSample(row, s) === key[0] ? 0 : 255;
      } else {
        out[o] = sample(row, s);
        out[o + 1] = sample(row, s + 1);
        out[o + 2] = sample(row, s + 2);
        out[o + 3] = type === 6 ? sample(row, s + 3) : key && key.every((k, i) => rawSample(row, s + i) === k) ? 0 : 255;
      }
    }
    previous = row;
  }
  return { width, height, data: out };
}

/** Scales pixels down so the longer side is at most `size`, averaging each box of source pixels (weighted by alpha, so edges don't darken). */
export function downscale(pixels: Pixels, size: number): Pixels {
  const ratio = Math.min(1, size / Math.max(pixels.width, pixels.height));
  if (ratio === 1) return pixels;
  const width = Math.max(1, Math.round(pixels.width * ratio));
  const height = Math.max(1, Math.round(pixels.height * ratio));
  const data = new Uint8Array(width * height * 4);
  const fx = pixels.width / width;
  const fy = pixels.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.min(pixels.height, Math.floor((y + 1) * fy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.min(pixels.width, Math.floor((x + 1) * fx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * pixels.width + sx) * 4;
          const alpha = pixels.data[i + 3]!;
          r += pixels.data[i]! * alpha;
          g += pixels.data[i + 1]! * alpha;
          b += pixels.data[i + 2]! * alpha;
          a += alpha;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        data[o] = Math.round(r / a);
        data[o + 1] = Math.round(g / a);
        data[o + 2] = Math.round(b / a);
      }
      data[o + 3] = Math.round(a / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, data };
}

function chunk(name: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA pixels as a PNG (8 bits a channel, no filtering, which is plenty for an icon). */
export function encodePng(pixels: Pixels): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixels.width, 0);
  header.writeUInt32BE(pixels.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = pixels.width * 4;
  const raw = Buffer.alloc(pixels.height * (stride + 1));
  for (let y = 0; y < pixels.height; y++) raw.set(pixels.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A PNG scaled down so its longer side is at most `size`, or null when it can't be read. */
export function shrinkPng(bytes: Uint8Array, size: number): Buffer | null {
  const pixels = decodePng(bytes);
  return pixels ? encodePng(downscale(pixels, size)) : null;
}
