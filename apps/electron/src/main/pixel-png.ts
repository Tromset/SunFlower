// Encodeur PNG minimal (RGBA 8 bits) — évite toute dépendance image pour
// rasteriser le tournesol pixel-art de l'icône de tray.
import { deflateSync } from "node:zlib";
import type { PixelArt } from "../shared/sunflower-pixels";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of buf) crc = (CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export function encodePngRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filtre none
    rgba
      .subarray(y * width * 4, (y + 1) * width * 4)
      .forEach((v, i) => (raw[rowStart + 1 + i] = v));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Rasterise un PixelArt (sans transform) en PNG, `scale` px par pixel d'art. */
export function pixelArtPng(art: PixelArt, scale: number): Buffer {
  const [vw, vh] = art.vb;
  const width = vw * scale;
  const height = vh * scale;
  const rgba = new Uint8Array(width * height * 4);
  for (const layer of art.layers) {
    for (const r of layer.rects) {
      const [cr, cg, cb] = [1, 3, 5].map((i) =>
        parseInt(r.c.slice(i, i + 2), 16),
      ) as [number, number, number];
      for (let y = r.y * scale; y < (r.y + r.h) * scale; y++) {
        for (let x = r.x * scale; x < (r.x + r.w) * scale; x++) {
          const o = (y * width + x) * 4;
          rgba[o] = cr;
          rgba[o + 1] = cg;
          rgba[o + 2] = cb;
          rgba[o + 3] = 255;
        }
      }
    }
  }
  return encodePngRgba(width, height, rgba);
}
