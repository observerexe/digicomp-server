import { useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Strokes } from '../../../shared/editor-schema/signature';
import { ApiError, type SignatureWanted } from '../api/client';
import { errorOf } from '../errors/messages';
import { SignaturePad } from './SignaturePad';

/** The server wants the reader's signature with the action (PAPER_SIGNATURE_REQUIRED). */
export const signatureWanted = (e: unknown): SignatureWanted | null => (e instanceof ApiError && e.code === 'PAPER_SIGNATURE_REQUIRED' ? (e.signature ?? null) : null);

/**
 * An action that freezes a document — accepting a task, publishing a document
 * that freezes at once, «Зафіксувати», a document for an old record: when a
 * signature line of it awaits the reader, it goes only with their signature.
 * The server says so (nothing is done yet): the window of the signature opens,
 * «Підписати» repeats the action with the drawing, «Скасувати» leaves all as it was.
 * `error` — the action's error to show on the page (not the one the window answers); `pad` — the window, while open.
 */
export function useSignWith<V extends { strokes?: Strokes }, D>(m: UseMutationResult<D, Error, V>) {
  const [waiting, setWaiting] = useState<{ vars: V; wanted: SignatureWanted } | null>(null);
  const mutate = (vars: V) =>
    m.mutate(vars, {
      onSuccess: () => setWaiting(null),
      onError: (e) => {
        const wanted = signatureWanted(e);
        if (wanted) setWaiting({ vars, wanted });
      },
    });
  const close = () => {
    setWaiting(null);
    m.reset();
  };
  const own = m.isError && !signatureWanted(m.error) ? m.error : null;
  const pad = waiting && (
    <SignaturePad
      lines={waiting.wanted.lines}
      about={waiting.wanted.number ? `№ ${waiting.wanted.number}` : `«${waiting.wanted.title}»`}
      pending={m.isPending}
      error={own ? errorOf(own) : null}
      onSign={(strokes) => mutate({ ...waiting.vars, strokes })}
      onClose={close}
    />
  );
  return { mutate, pad, error: waiting ? null : own, isPending: m.isPending };
}
