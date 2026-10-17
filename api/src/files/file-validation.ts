import { BadRequestException } from '@nestjs/common';

export type UploadedFileLike = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type Kind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'zip' | 'text';

const TYPES: Record<string, { mime: string; kind: Kind }> = {
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  png: { mime: 'image/png', kind: 'png' },
  jpg: { mime: 'image/jpeg', kind: 'jpeg' },
  jpeg: { mime: 'image/jpeg', kind: 'jpeg' },
  webp: { mime: 'image/webp', kind: 'webp' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'zip',
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'zip',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'zip',
  },
  txt: { mime: 'text/plain; charset=utf-8', kind: 'text' },
  md: { mime: 'text/plain; charset=utf-8', kind: 'text' },
  csv: { mime: 'text/csv; charset=utf-8', kind: 'text' },
};

export const DOCUMENT_EXTENSIONS = Object.keys(TYPES);
export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

export function mimeForExtension(ext: string) {
  return TYPES[ext]?.mime ?? 'application/octet-stream';
}

function matchesSignature(kind: Kind, b: Buffer) {
  switch (kind) {
    case 'pdf':
      return b.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'png':
      return (
        b.length > 8 &&
        b
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case 'jpeg':
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'webp':
      return (
        b.length > 12 &&
        b.subarray(0, 4).toString('latin1') === 'RIFF' &&
        b.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'zip':
      return (
        b.length > 4 &&
        b[0] === 0x50 &&
        b[1] === 0x4b &&
        b[2] === 0x03 &&
        b[3] === 0x04
      );
    case 'text':
      return !b.subarray(0, 8192).includes(0);
  }
}

function fixName(name: string) {
  if (/[^\u0000-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

export function sanitizeFileName(name: string) {
  const base = fixName(name).split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 ? clean.slice(dot) : '';
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  return (stem.slice(0, 150) || 'file') + ext.slice(0, 10);
}

export function validateUpload(
  file: UploadedFileLike | undefined,
  allowed: string[],
) {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException('File is required');
  }
  const fileName = sanitizeFileName(file.originalname);
  const ext = fileName.includes('.')
    ? fileName.split('.').pop()!.toLowerCase()
    : '';
  const type = TYPES[ext];
  if (!type || !allowed.includes(ext)) {
    throw new BadRequestException('File type is not allowed');
  }
  if (!matchesSignature(type.kind, file.buffer)) {
    throw new BadRequestException('File content does not match its type');
  }
  return { fileName, ext: ext === 'jpeg' ? 'jpg' : ext, mime: type.mime };
}
