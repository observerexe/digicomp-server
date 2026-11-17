import type { Editor } from '@tiptap/core';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, unwrap } from '../api/client';
import { errorOf } from '../errors/messages';

/**
 * «Зображення» from the person's files: the browser shrinks a picture to
 * IMAGE_MAX_SIDE and encodes it anew (EXIF — the place a phone took a photo
 * in — goes), uploads it (`POST /paper-images`) and the sheet takes its id.
 */

/** What the person may pick; the API takes PNG and JPEG only (a WebP becomes a JPEG). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
export const IMAGE_MAX_SIDE = 2000;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** JPEG qualities, tried in turn until the file fits IMAGE_MAX_BYTES. */
const QUALITIES = [0.9, 0.8, 0.65, 0.5];

/** The size within IMAGE_MAX_SIDE a side, proportions kept; a smaller picture stays as it is. */
export function fitSize(width: number, height: number, max = IMAGE_MAX_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** A PNG stays a PNG (a logo keeps its transparency), the rest — a JPEG; null — not a picture the editor takes. */
export function outputType(type: string): 'image/png' | 'image/jpeg' | null {
  if (type === 'image/png') return 'image/png';
  return type === 'image/jpeg' || type === 'image/webp' ? 'image/jpeg' : null;
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** The picture shrunk and encoded anew: a PNG, or a JPEG on white (a PNG over 5 MB — a JPEG too). */
export async function prepareImage(file: File): Promise<Blob> {
  const type = outputType(file.type);
  if (!type) throw new ApiError(0, 'FILE_TYPE_NOT_ALLOWED');
  let bitmap: ImageBitmap;
  try {
    // Turned as the photo's EXIF says (imageOrientation: from-image is the default).
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ApiError(0, 'FILE_CONTENT_MISMATCH');
  }
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const draw = (white: boolean) => {
    ctx.clearRect(0, 0, width, height);
    if (white) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
  };
  try {
    if (type === 'image/png') {
      draw(false);
      const png = await encode(canvas, 'image/png');
      if (png && png.size <= IMAGE_MAX_BYTES) return png;
    }
    draw(true);
    for (const q of QUALITIES) {
      const jpeg = await encode(canvas, 'image/jpeg', q);
      if (jpeg && jpeg.size <= IMAGE_MAX_BYTES) return jpeg;
    }
  } finally {
    bitmap.close();
  }
  throw new ApiError(0, 'FILE_TOO_LARGE');
}

/** Uploads a prepared picture: its id for the `image` node. */
export async function uploadImage(blob: Blob): Promise<string> {
  const body = new FormData();
  body.append('file', blob, blob.type === 'image/png' ? 'image.png' : 'image.jpg');
  const res = await unwrap(api.POST('/api/paper-images', { body: body as never }));
  return res.id;
}

/** Any image id: to ask the sheet whether an image may stand at the selection at all. */
const PROBE = '00000000-0000-4000-8000-000000000000';
/** Not a code of the API: the sheet takes no image here (text of a template, a plain zone). */
export const IMAGE_NOT_HERE = 'Сюди зображення не вставити: лише в текст документа чи у вільну зону.';

/** Puts an image at the selection, or at `at` (a drop); false — the sheet took none there. */
export type PlaceImage = (id: string, at: number | null) => boolean;

const placeAt =
  (editor: Editor): PlaceImage =>
  (id, at) =>
    editor
      .chain()
      .focus()
      .insertImage(id, at ?? undefined)
      .run();

/**
 * Images of a sheet: «Вставка → Зображення» (`pick`), pasted and dropped
 * pictures (the Image extension's `onFiles`). While they upload — `busy`;
 * what went wrong — `error` (a text). `picker` — the hidden file input the
 * page renders; `place` — how a picked image goes on the sheet (the
 * constructor puts it as a block).
 */
export function useImages(editor: Editor | null): {
  busy: boolean;
  error: string | null;
  pick: (place?: (id: string) => void) => void;
  picker: ReactNode;
} {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const placing = useRef<((id: string) => void) | null>(null);

  const insert = useCallback(
    async (files: File[], at: number | null, place: ((id: string) => void) | null) => {
      if (!editor || !files.length) return;
      // Not where the sheet takes no image: nothing is uploaded for nothing.
      if (!place && !editor.can().insertImage(PROBE)) {
        setError(IMAGE_NOT_HERE);
        return;
      }
      setError(null);
      setBusy((n) => n + 1);
      try {
        for (const file of files) {
          const id = await uploadImage(await prepareImage(file));
          if (editor.isDestroyed) return;
          if (place) place(id);
          else if (!placeAt(editor)(id, at)) setError(IMAGE_NOT_HERE);
        }
      } catch (e) {
        setError(errorOf(e));
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    editor.storage.image.onFiles = (files, at) => void insert(files, at, null);
    // What went wrong stays till the sheet changes.
    const clear = () => setError(null);
    editor.on('update', clear);
    return () => {
      editor.off('update', clear);
      if (!editor.isDestroyed) editor.storage.image.onFiles = null;
    };
  }, [editor, insert]);

  const pick = useCallback((place?: (id: string) => void) => {
    placing.current = place ?? null;
    input.current?.click();
  }, []);

  const picker = createElement('input', {
    ref: input,
    type: 'file',
    accept: IMAGE_ACCEPT,
    multiple: true,
    hidden: true,
    'aria-hidden': true,
    tabIndex: -1,
    onChange: (e: { currentTarget: HTMLInputElement }) => {
      const files = [...(e.currentTarget.files ?? [])];
      e.currentTarget.value = '';
      void insert(files, null, placing.current);
      placing.current = null;
    },
  });

  return { busy: busy > 0, error, pick, picker };
}
