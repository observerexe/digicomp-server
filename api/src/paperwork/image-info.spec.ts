import { imageInfo } from './image-info';

/** A PNG's header: the signature and IHDR (the rest is not read). */
export function pngHeader(width: number, height: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** A JPEG's start: SOI, APP1 (EXIF), a standalone RST, then SOF2. */
function jpegHeader(width: number, height: number, frame = 0xc2) {
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, 0x00, 0x08]),
    Buffer.from('Exif\0\0', 'latin1'),
  ]);
  const sof = Buffer.alloc(19);
  sof.set([0xff, frame, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    Buffer.from([0xff, 0xff, 0xd0]),
    sof,
  ]);
}

describe('Зображення: тип і розмір за заголовком', () => {
  it('PNG', () => {
    expect(imageInfo(pngHeader(640, 480))).toEqual({
      type: 'png',
      mime: 'image/png',
      width: 640,
      height: 480,
    });
  });

  it('JPEG: розмір з кадру SOF після інших сегментів', () => {
    expect(imageInfo(jpegHeader(1200, 900))).toEqual({
      type: 'jpg',
      mime: 'image/jpeg',
      width: 1200,
      height: 900,
    });
    expect(imageInfo(jpegHeader(30, 20, 0xc0))?.width).toBe(30);
  });

  it('не зображення, WebP, обрізаний заголовок, нульовий розмір — ні', () => {
    expect(imageInfo(Buffer.from('%PDF-1.7 hello'))).toBeNull();
    expect(imageInfo(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBeNull();
    expect(imageInfo(pngHeader(10, 10).subarray(0, 20))).toBeNull();
    expect(imageInfo(jpegHeader(10, 10).subarray(0, 14))).toBeNull();
    expect(imageInfo(pngHeader(0, 10))).toBeNull();
    // DHT (C4) — не кадр: розміру немає, далі дані.
    expect(
      imageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x02, 0xff, 0xda])),
    ).toBeNull();
  });
});
