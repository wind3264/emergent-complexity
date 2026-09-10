/**
 * Minimal PNG writer, used to save board snapshots from the batch scripts so the
 * report can show figures that were produced by the same runs that produced the
 * numbers, rather than by hand-taken screenshots.
 *
 * Writes 8-bit truecolour PNGs (colour type 2) with no filtering.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `rgb` is a width*height*3 byte array in row-major order. */
export function writePng(path, width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const PALETTE = {
  background: [5, 7, 11],
  alive: [94, 234, 212],
  born: [240, 253, 250],
  noise: [251, 191, 36],
  dying: [244, 63, 94],
  frame: [30, 41, 59],
};

/**
 * Renders a grid at `scale` pixels per cell. `overlays` maps a colour name from
 * the palette to a set of cell indices drawn in that colour instead of `alive`.
 */
export function writeGridPng(path, grid, { scale = 4, overlays = {}, pad = 2 } = {}) {
  const { width: w, height: h, cells } = grid;
  const pw = w * scale + pad * 2;
  const ph = h * scale + pad * 2;
  const rgb = new Uint8Array(pw * ph * 3);
  for (let i = 0; i < pw * ph; i++) {
    rgb[i * 3] = PALETTE.background[0];
    rgb[i * 3 + 1] = PALETTE.background[1];
    rgb[i * 3 + 2] = PALETTE.background[2];
  }

  const colourOf = new Map();
  for (const [name, indices] of Object.entries(overlays)) {
    for (const index of indices) colourOf.set(index, PALETTE[name]);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      const colour = colourOf.get(index) ?? (cells[index] ? PALETTE.alive : null);
      if (!colour) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y * scale + dy + pad) * pw + x * scale + dx + pad) * 3;
          rgb[px] = colour[0];
          rgb[px + 1] = colour[1];
          rgb[px + 2] = colour[2];
        }
      }
    }
  }
  writePng(path, pw, ph, rgb);
}

/**
 * Lays out several equally sized grids side by side with a thin separator, so a
 * figure can show one rule at several times or several noise levels.
 */
export function writeStripPng(path, grids, { scale = 3, gap = 6 } = {}) {
  const w = grids[0].width;
  const h = grids[0].height;
  const cellW = w * scale;
  const pw = cellW * grids.length + gap * (grids.length - 1);
  const ph = h * scale;
  const rgb = new Uint8Array(pw * ph * 3);
  for (let i = 0; i < pw * ph; i++) {
    rgb[i * 3] = PALETTE.frame[0];
    rgb[i * 3 + 1] = PALETTE.frame[1];
    rgb[i * 3 + 2] = PALETTE.frame[2];
  }
  grids.forEach((grid, panel) => {
    const x0 = panel * (cellW + gap);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const colour = grid.cells[y * w + x] ? PALETTE.alive : PALETTE.background;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = ((y * scale + dy) * pw + x0 + x * scale + dx) * 3;
            rgb[px] = colour[0];
            rgb[px + 1] = colour[1];
            rgb[px + 2] = colour[2];
          }
        }
      }
    }
  });
  writePng(path, pw, ph, rgb);
}
