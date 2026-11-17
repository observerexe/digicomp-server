/**
 * The kind and size of a PNG or a JPEG from its header alone: the file is
 * checked by its content, never by its name, and nothing is decoded.
 */
export type ImageInfo = {
  type: 'png' | 'jpg';
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function png(b: Buffer): ImageInfo | null {
  // The signature, then the first chunk — IHDR: width and height.
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (b.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return {
    type: 'png',
    mime: 'image/png',
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
  };
}

/** Markers with no length after them. */
const STANDALONE = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
]);
/** SOF0…SOF15 but DHT (C4), JPG (C8) and DAC (CC): a frame with its size. */
const isFrame = (m: number) =>
  m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    return null;
  }
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (STANDALONE.has(marker)) {
      i += 2;
      continue;
    }
    // The start of the image data before any frame, or the end: no size.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    if (isFrame(marker)) {
      if (i + 9 > b.length) return null;
      return {
        type: 'jpg',
        mime: 'image/jpeg',
        height: b.readUInt16BE(i + 5),
        width: b.readUInt16BE(i + 7),
      };
    }
    i += 2 + length;
  }
  return null;
}

/** A PNG or a JPEG of a non-zero size; null — neither (or its header is broken). */
export function imageInfo(b: Buffer): ImageInfo | null {
  const info = png(b) ?? jpeg(b);
  return info && info.width > 0 && info.height > 0 ? info : null;
}
