/**
 * Generates the PWA / Apple touch icons as real PNG files, with no image
 * library dependency (sharp fails to install cleanly on some Windows setups).
 * A tiny hand-rolled PNG encoder draws the brand mark: an oxblood heart on the
 * parchment ground. Re-run with `npx tsx scripts/generate-icons.ts` if the
 * brand colors change. Output lands in public/icons + public/favicon.png so
 * `expo export` copies them into dist/ verbatim.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Brand colors (kept in sync with src/theme.ts by hand; placeholders are fine).
const PARCHMENT: [number, number, number] = [0xf4, 0xec, 0xdd];
const OXBLOOD: [number, number, number] = [0x7e, 0x38, 0x2c];

/** Classic heart implicit curve: (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0. */
function insideHeart(px: number, py: number, size: number): boolean {
  const u = ((px + 0.5) / size - 0.5) * 3.0;
  const v = (0.5 - (py + 0.5) / size) * 3.0 + 0.2;
  const a = u * u + v * v - 1;
  return a * a * a - u * u * v * v * v <= 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size: number): Buffer {
  // Raw RGBA scanlines, each prefixed with a 0 (no-filter) byte.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = insideHeart(x, y, size) ? OXBLOOD : PARCHMENT;
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = 0xff;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = join(__dirname, '..');
const iconsDir = join(root, 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

for (const size of [152, 180, 192, 512]) {
  writeFileSync(join(iconsDir, `icon-${size}.png`), encodePng(size));
  console.log(`wrote public/icons/icon-${size}.png`);
}
writeFileSync(join(root, 'public', 'favicon.png'), encodePng(48));
console.log('wrote public/favicon.png');
