import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

/**
 * saved — everything is on the server; dirty — changes wait for the pause;
 * saving — a request is on its way; error — the last save failed (retried);
 * rejected — the server refused the change (an invalid value): sent again with the next change;
 * conflict — someone else changed the document: saving stops (409 PAPER_CONFLICT).
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'rejected' | 'conflict';

/** Pause after the last change before saving. */
export const SAVE_DELAY = 1500;
/** After a failed save (network) — try again. */
export const RETRY_DELAY = 10_000;

/** What the server answers to a save: the next revision. */
export type Saved = { revision: number; updatedAt: string };

/**
 * Autosave of a draft (a document, a template version): one save at a time
 * with the last known revision; changes made while a request is on its way
 * go with the next one. A change of a part replaces its pending value (the
 * latest wins). `send` — the PATCH of the draft.
 */
export function useAutosave<C extends object>(send: (change: Partial<C>, revision: number) => Promise<Saved>, initialRevision: number) {
  const [state, setState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /** Why the server refused the last save (state rejected). */
  const [rejection, setRejection] = useState<ApiError | null>(null);
  const revision = useRef(initialRevision);
  const pending = useRef<Partial<C>>({});
  // The latest `send`: a new function each render must not restart the saving.
  const sendRef = useRef(send);
  sendRef.current = send;
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  /** Refused by the server: the pending change waits for the next one. */
  const held = useRef(false);

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
        const res = await sendRef.current(change, revision.current);
        revision.current = res.revision;
        setSavedAt(new Date(res.updatedAt));
        setRejection(null);
        setState(Object.keys(pending.current).length ? 'dirty' : 'saved');
      } catch (e) {
        // Newer changes made meanwhile win over the failed ones.
        pending.current = { ...change, ...pending.current };
        if (e instanceof ApiError && e.code === 'PAPER_CONFLICT') {
          stopped.current = true;
          setState('conflict');
          return;
        }
        // The same request would be refused again: wait for the next change.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          setRejection(e);
          setState('rejected');
          held.current = true;
          return;
        }
        setState('error');
        timer.current = setTimeout(() => void save(), RETRY_DELAY);
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (!stopped.current && !held.current && Object.keys(pending.current).length && !timer.current) await save();
  }, []);

  const change = useCallback(
    (c: Partial<C>) => {
      if (stopped.current) return;
      pending.current = { ...pending.current, ...c };
      held.current = false;
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

  return { state, savedAt, rejection, change, flush, cancel, revision: () => revision.current };
}
