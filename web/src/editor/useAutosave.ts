import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { api, ApiError, unwrap } from '../api/client';

export type PaperChange = { title?: string; content?: JSONContent };

/**
 * saved — everything is on the server; dirty — changes wait for the pause;
 * saving — a request is on its way; error — the last save failed (retried);
 * conflict — someone else changed the document: saving stops (409 PAPER_CONFLICT).
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

/** Pause after the last change before saving. */
export const SAVE_DELAY = 1500;
/** After a failed save (network) — try again. */
export const RETRY_DELAY = 10_000;

/**
 * Autosave of a draft: one PATCH at a time with the last known revision;
 * changes made while a request is on its way go with the next one.
 * A change of a field replaces its pending value (the latest wins).
 */
export function useAutosave(id: string, initialRevision: number) {
  const [state, setState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const revision = useRef(initialRevision);
  const pending = useRef<PaperChange>({});
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const save = useCallback(async (): Promise<void> => {
    clearTimer();
    if (stopped.current) return;
    if (inFlight.current) {
      // The change will go right after the current request.
      await inFlight.current;
      return save();
    }
    const change = pending.current;
    if (Object.keys(change).length === 0) return;
    pending.current = {};
    setState('saving');
    const run = (async () => {
      try {
        const res = await unwrap(api.PATCH('/api/papers/{id}', { params: { path: { id } }, body: { revision: revision.current, ...change } }));
        revision.current = res.revision;
        setSavedAt(new Date(res.updatedAt));
        setState(Object.keys(pending.current).length ? 'dirty' : 'saved');
      } catch (e) {
        // Newer changes made meanwhile win over the failed ones.
        pending.current = { ...change, ...pending.current };
        if (e instanceof ApiError && e.code === 'PAPER_CONFLICT') {
          stopped.current = true;
          setState('conflict');
          return;
        }
        setState('error');
        timer.current = setTimeout(() => void save(), RETRY_DELAY);
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (!stopped.current && Object.keys(pending.current).length && !timer.current) await save();
  }, [id]);

  const change = useCallback(
    (c: PaperChange) => {
      if (stopped.current) return;
      pending.current = { ...pending.current, ...c };
      setState((s) => (s === 'saving' || s === 'error' ? s : 'dirty'));
      clearTimer();
      timer.current = setTimeout(() => void save(), SAVE_DELAY);
    },
    [save],
  );

  /** Save now (leaving the page). */
  const flush = useCallback(() => save(), [save]);

  /** Drop what is not saved and stop (the draft is being deleted). */
  const cancel = useCallback(() => {
    clearTimer();
    pending.current = {};
    stopped.current = true;
  }, []);

  // Leaving the editor inside the app — save at once; closing the tab with
  // unsaved changes — the browser asks.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || inFlight.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      void save();
    };
  }, [save]);

  return { state, savedAt, change, flush, cancel, revision: () => revision.current };
}
