// Deterministic, dependency-free PNG icon generation for the PWA manifest (B-6).
//
// The manifest previously declared both its 192x192 and 512x512 entries as the SAME inline
// SVG data URI. Chromium's install criteria require at least one PNG/raster icon >= 192px and
// a `maskable` entry for a non-letterboxed adaptive icon, so that manifest never produced an
// install prompt. Rasterising here (rather than committing binaries) keeps the icons a build
// product like app.js and sw.js: reproducible from source, byte-identical across machines.
//
// No image library is used on purpose -- a PNG of a flat-colour rounded rect is a few dozen
// lines of zlib + CRC32, and adding a native/heavy dependency to emit two squares would be a
// worse trade than owning this code.

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode an RGBA pixel buffer (size*size*4, row-major) as a PNG.
 * Filter type 0 (None) on every scanline: the images are flat colour, so the more elaborate
 * filters buy nothing and a fixed filter keeps the output byte-stable.
 */
function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  // Level 9 + fixed strategy so repeated builds produce identical bytes.
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

// Brand palette, kept in step with manifest.json's background_color/theme_color.
const BACKGROUND = '#1e1e2e';
const GLYPH = '#89b4fa';
const GLYPH_DIM = '#cba6f7';

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Render the stubs mark: two stacked rounded bars -- the upper one the code file, the lower
 * (dimmer, inset) one its Markdown sidecar. `glyphScale` is the fraction of the canvas the
 * mark occupies; the maskable variant uses a smaller value so the whole mark sits inside the
 * central 80% safe zone that Android's adaptive-icon mask can crop to.
 *
 * Coverage is supersampled SSAA_N x SSAA_N per pixel and the sampled colours averaged: a hard
 * one-sample-per-pixel test produces visibly jagged bar edges at 192px, which reads as a
 * low-quality icon in the install prompt.
 */
const SSAA_N = 4;

function renderIcon(size, glyphScale) {
  const rgba = Buffer.alloc(size * size * 4);
  const background = hexToRgb(BACKGROUND);
  const glyph = hexToRgb(GLYPH);
  const glyphDim = hexToRgb(GLYPH_DIM);

  const span = size * glyphScale;
  const left = (size - span) / 2;
  const right = left + span;
  const barHeight = span * 0.34;
  const gap = span * 0.14;
  const topBarTop = (size - (barHeight * 2 + gap)) / 2;
  const bottomBarTop = topBarTop + barHeight + gap;
  const radius = barHeight * 0.28;
  const inset = span * 0.16; // the sidecar bar is indented under its code file

  const samples = SSAA_N * SSAA_N;
  const step = 1 / SSAA_N;
  const offsetToCentre = step / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < SSAA_N; sy++) {
        const py = y + sy * step + offsetToCentre;
        for (let sx = 0; sx < SSAA_N; sx++) {
          const px = x + sx * step + offsetToCentre;

          let colour = background;
          if (insideRoundedRect(px, py, left, topBarTop, right, topBarTop + barHeight, radius)) {
            colour = glyph;
          } else if (
            insideRoundedRect(
              px,
              py,
              left + inset,
              bottomBarTop,
              right,
              bottomBarTop + barHeight,
              radius,
            )
          ) {
            colour = glyphDim;
          }

          r += colour[0];
          g += colour[1];
          b += colour[2];
        }
      }

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r / samples);
      rgba[offset + 1] = Math.round(g / samples);
      rgba[offset + 2] = Math.round(b / samples);
      rgba[offset + 3] = 255; // fully opaque: a maskable icon must not show through
    }
  }

  return encodePng(size, rgba);
}

/**
 * The icon set emitted into dist/web/ and declared by public/manifest.json.
 * `purpose: 'any'` at 192 and 512 satisfies the installability minimum; the maskable entry
 * keeps the mark inside the safe zone so Android does not letterbox it.
 */
const ICONS = [
  { file: 'icon-192.png', size: 192, glyphScale: 0.62, purpose: 'any' },
  { file: 'icon-512.png', size: 512, glyphScale: 0.62, purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, glyphScale: 0.44, purpose: 'maskable' },
];

module.exports = { encodePng, renderIcon, crc32, ICONS, BACKGROUND, GLYPH, GLYPH_DIM };
