// Minimal PNG toolkit for the icon pipeline: decode Chromium screenshots,
// quantize to a palette (median cut) and encode the smallest PNG we can.
// Kept dependency-free on purpose (no sharp/pngquant in the toolchain).

import { deflateSync, inflateSync, constants } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes an 8-bit, non-interlaced RGB/RGBA/grey PNG (what Chromium emits) to RGBA. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (depth !== 8 || data[12] !== 0) throw new Error('Unsupported PNG (depth/interlace)');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!bpp) throw new Error(`Unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      px[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += bpp) {
    if (bpp >= 3) {
      rgba[i * 4] = px[j];
      rgba[i * 4 + 1] = px[j + 1];
      rgba[i * 4 + 2] = px[j + 2];
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[j];
    }
    rgba[i * 4 + 3] = bpp === 4 ? px[j + 3] : bpp === 2 ? px[j + 1] : 255;
  }
  return { width, height, data: rgba };
}

/** Applies a PNG row filter (0..4) to one scanline. */
function filterRow(f, cur, prev, bpp, out, o) {
  out[o] = f;
  for (let x = 0; x < cur.length; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = x >= bpp && prev ? prev[x - bpp] : 0;
    const v = cur[x];
    out[o + 1 + x] = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 0xff;
  }
}

/** Filters every row: either one fixed filter, or the classic min-sum-of-abs heuristic. */
function filterImage(px, width, height, bpp, mode) {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  const tmp = Buffer.alloc(stride + 1);
  for (let y = 0; y < height; y++) {
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    const o = y * (stride + 1);
    if (mode !== 'adaptive') {
      filterRow(mode, cur, prev, bpp, out, o);
      continue;
    }
    let best = Infinity;
    for (let f = 0; f <= 4; f++) {
      filterRow(f, cur, prev, bpp, tmp, 0);
      let sum = 0;
      for (let i = 1; i < tmp.length; i++) sum += tmp[i] < 128 ? tmp[i] : 256 - tmp[i];
      if (sum < best) {
        best = sum;
        tmp.copy(out, o);
      }
    }
  }
  return out;
}

/** Deflates with a few zlib strategies and keeps the smallest stream. */
function bestDeflate(buf) {
  let best = null;
  for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED]) {
    const z = deflateSync(buf, { level: 9, memLevel: 9, strategy });
    if (!best || z.length < best.length) best = z;
  }
  return best;
}

function ihdr(width, height, colorType) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width, 0);
  h.writeUInt32BE(height, 4);
  h[8] = 8;
  h[9] = colorType;
  return h;
}

/** Lossless truecolour encode (RGB when fully opaque, else RGBA). */
export function encodeTruecolor({ width, height, data }) {
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  let px = data;
  if (opaque) {
    px = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      px[j] = data[i];
      px[j + 1] = data[i + 1];
      px[j + 2] = data[i + 2];
    }
  }
  const bpp = opaque ? 3 : 4;
  const idat = bestDeflate(filterImage(px, width, height, bpp, 'adaptive'));
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr(width, height, opaque ? 2 : 6)), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Weighted sum of squared errors of a colour box around its mean (all four channels). */
function boxStats(box) {
  let n = 0;
  const s = [0, 0, 0, 0];
  const s2 = [0, 0, 0, 0];
  for (const c of box) {
    const w = c[4];
    n += w;
    for (let k = 0; k < 4; k++) {
      s[k] += c[k] * w;
      s2[k] += c[k] * c[k] * w;
    }
  }
  let sse = 0;
  let axis = 0;
  let axisSse = -1;
  for (let k = 0; k < 4; k++) {
    const e = s2[k] - (s[k] * s[k]) / n;
    sse += e;
    if (e > axisSse) {
      axisSse = e;
      axis = k;
    }
  }
  return { sse: box.length > 1 ? sse : 0, axis, mean: s.map((v) => v / n) };
}

/** Splits a box along `axis` at the cut that minimises the two halves' SSE (optimal in 1D). */
function splitBox(box, axis) {
  box.sort((a, b) => a[axis] - b[axis]);
  let tw = 0;
  let tx = 0;
  for (const c of box) {
    tw += c[4];
    tx += c[axis] * c[4];
  }
  let w = 0;
  let x = 0;
  let best = 1;
  let bestScore = -Infinity;
  for (let i = 0; i < box.length - 1; i++) {
    w += box[i][4];
    x += box[i][axis] * box[i][4];
    if (box[i][axis] === box[i + 1][axis]) continue;
    // Maximising between-group variance == minimising the halves' SSE.
    const score = (x * x) / w + ((tx - x) * (tx - x)) / (tw - w);
    if (score > bestScore) {
      bestScore = score;
      best = i + 1;
    }
  }
  return [box.slice(0, best), box.slice(best)];
}

/**
 * Variance-based median cut to at most `maxColors` RGBA entries, then a few
 * k-means passes to settle each entry on its cluster. Fully transparent
 * pixels get a reserved exact slot so icon corners stay clean.
 */
function buildPalette(data, maxColors) {
  const hist = new Map();
  let hasClear = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      hasClear = true;
      continue;
    }
    const key = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  const colors = [];
  for (const [key, count] of hist) colors.push([key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255, count]);
  const slots = maxColors - (hasClear ? 1 : 0);

  let palette;
  if (colors.length <= slots) {
    palette = colors.map((c) => [c[0], c[1], c[2], c[3]]);
  } else {
    const boxes = [{ items: colors, ...boxStats(colors) }];
    while (boxes.length < slots) {
      let bi = 0;
      for (let i = 1; i < boxes.length; i++) if (boxes[i].sse > boxes[bi].sse) bi = i;
      if (boxes[bi].sse <= 0) break;
      const halves = splitBox(boxes[bi].items, boxes[bi].axis);
      boxes.splice(bi, 1, ...halves.map((items) => ({ items, ...boxStats(items) })));
    }
    palette = boxes.map((b) => b.mean.slice());
    // k-means refinement over the unique colours (weighted by pixel count).
    for (let iter = 0; iter < 6; iter++) {
      const acc = palette.map(() => [0, 0, 0, 0, 0]);
      for (const c of colors) {
        const a = acc[nearest(palette, c[0], c[1], c[2], c[3])];
        for (let k = 0; k < 4; k++) a[k] += c[k] * c[4];
        a[4] += c[4];
      }
      palette = palette.map((p, i) => (acc[i][4] ? acc[i].slice(0, 4).map((v) => v / acc[i][4]) : p));
    }
    palette = palette.map((p) => p.map((v) => Math.round(v)));
  }
  if (hasClear) palette.unshift([0, 0, 0, 0]);
  return palette;
}

function nearest(palette, r, g, b, a) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    // Alpha differences matter most at antialiased edges over unknown backgrounds.
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2 + 2 * (p[3] - a) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/**
 * Lossy palette encode. `dither` (0..1) is the Floyd–Steinberg strength used
 * to hide banding in the water gradient. Returns the PNG plus its PSNR.
 */
export function encodeIndexed(img, { colors = 256, dither = 0 } = {}) {
  const { width, height, data } = img;
  const palette = buildPalette(data, colors);
  // Transparent entries first so tRNS can be truncated.
  const order = palette.map((p, i) => i).sort((i, j) => (palette[i][3] === 255) - (palette[j][3] === 255));
  const pal = order.map((i) => palette[i]);
  const idx = Buffer.alloc(width * height);
  const cache = new Map();
  const err = dither > 0 ? new Float32Array(width * height * 4) : null;
  let se = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      let r = data[o];
      let g = data[o + 1];
      let b = data[o + 2];
      let a = data[o + 3];
      if (err && a === 255) {
        r = Math.max(0, Math.min(255, Math.round(r + err[o])));
        g = Math.max(0, Math.min(255, Math.round(g + err[o + 1])));
        b = Math.max(0, Math.min(255, Math.round(b + err[o + 2])));
      }
      let p;
      if (a === 0) p = 0;
      else {
        const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
        p = cache.get(key);
        if (p === undefined) {
          p = nearest(pal, r, g, b, a);
          cache.set(key, p);
        }
      }
      idx[i] = p;
      const c = pal[p];
      se += (c[0] - data[o]) ** 2 + (c[1] - data[o + 1]) ** 2 + (c[2] - data[o + 2]) ** 2 + (c[3] - data[o + 3]) ** 2;
      // Only diffuse inside opaque areas: spreading error across edges creates halos.
      if (err && a === 255) {
        for (let k = 0; k < 3; k++) {
          const e = ((k === 0 ? r : k === 1 ? g : b) - c[k]) * dither;
          if (x + 1 < width) err[o + 4 + k] += (e * 7) / 16;
          if (y + 1 < height) {
            if (x > 0) err[o + width * 4 - 4 + k] += (e * 3) / 16;
            err[o + width * 4 + k] += (e * 5) / 16;
            if (x + 1 < width) err[o + width * 4 + 4 + k] += e / 16;
          }
        }
      }
    }
  }
  const mse = se / (width * height * 4);
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);

  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((c, i) => {
    plte[i * 3] = c[0];
    plte[i * 3 + 1] = c[1];
    plte[i * 3 + 2] = c[2];
  });
  const lastAlpha = pal.findLastIndex((c) => c[3] !== 255);
  const chunks = [chunk('IHDR', ihdr(width, height, 3)), chunk('PLTE', plte)];
  if (lastAlpha >= 0) chunks.push(chunk('tRNS', Buffer.from(pal.slice(0, lastAlpha + 1).map((c) => c[3]))));
  // Palette images usually compress best unfiltered, but not always: try both.
  let idat = null;
  for (const mode of [0, 'adaptive']) {
    const z = bestDeflate(filterImage(idx, width, height, 1, mode));
    if (!idat || z.length < idat.length) idat = z;
  }
  chunks.push(chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)));
  return { png: Buffer.concat([SIGNATURE, ...chunks]), psnr, colors: pal.length };
}
