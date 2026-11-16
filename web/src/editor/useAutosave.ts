import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { deleteDraft, draftKey, putDraft, type DraftTarget } from '../lib/localDrafts';

/**
 * saved — everything is on the server; dirty — changes wait for the pause;
 * saving — a request is on its way; error — the last save failed (retried);
 * local — the same, but the changes are kept on this device;
 * rejected — the server refused the change (an invalid value): sent again with the next change;
 * conflict — someone else changed the document: saving stops (409 PAPER_CONFLICT).
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'local' | 'rejected' | 'conflict';

/** Pause after the last change before saving. */
export const SAVE_DELAY = 1500;
/** After a failed save (network) — try again; at once when the connection is back. */
export const RETRY_DELAY = 10_000;

/** What the server answers to a save: the next revision. */
export type Saved = { revision: number; updatedAt: string };

/** Where unsent changes are kept on the device; `restored` — those kept last time, sent at once. */
export type LocalCopy<C> = { userId: string; target: DraftTarget; restored?: Partial<C> | null };

/**
 * Autosave of a draft (a document, a template version): one save at a time
 * with the last known revision; changes made while a request is on its way
 * go with the next one. A change of a part replaces its pending value (the
 * latest wins). `send` — the PATCH of the draft. With `local` what the server
 * has not received yet is also kept on the device (see lib/localDrafts.ts).
 */
export function useAutosave<C extends object>(send: (change: Partial<C>, revision: number) => Promise<Saved>, initialRevision: number, local?: LocalCopy<C> | null) {
  const restored = local?.restored && Object.keys(local.restored).length ? local.restored : null;
  const [state, setState] = useState<SaveState>(restored ? 'dirty' : 'saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /** Why the server refused the last save (state rejected). */
  const [rejection, setRejection] = useState<ApiError | null>(null);
  const revision = useRef(initialRevision);
  const pending = useRef<Partial<C>>(restored ?? {});
  /** The change on its way. */
  const sending = useRef<Partial<C>>({});
  // The latest `send`: a new function each render must not restart the saving.
  const sendRef = useRef(send);
  sendRef.current = send;
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  /** Refused by the server: the pending change waits for the next one. */
  const held = useRef(false);

  // The copy on the device: `kept` — the last write done; `wrote` — writes asked for.
  const where = useRef(local ? { userId: local.userId, target: local.target, key: draftKey(local.userId, local.target) } : null);
  const wrote = useRef(0);
  const kept = useRef(restored ? 0 : -1);
  /** The device keeps nothing (no IndexedDB, or writing failed). */
  const noStore = useRef(!where.current);

  /** What the server has not received yet goes to the device; nothing left — the copy goes away. */
  const keep = useCallback(() => {
    const w = where.current;
    if (!w) return;
    const unsent = { ...sending.current, ...pending.current };
    const n = ++wrote.current;
    if (!Object.keys(unsent).length) {
      kept.current = n;
      void deleteDraft(w.key);
      return;
    }
    void putDraft({ key: w.key, userId: w.userId, target: w.target, revision: revision.current, change: unsent, at: new Date().toISOString() }).then((ok) => {
      noStore.current = !ok;
      if (ok && n > kept.current) kept.current = n;
    });
  }, []);
  /** Unsent changes not yet on the device: leaving would lose them. */
  const atRisk = () => (Object.keys(pending.current).length > 0 || inFlight.current !== null) && (noStore.current || kept.current !== wrote.current);

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
    sending.current = change;
    setState('saving');
    const run = (async () => {
      try {
        const res = await sendRef.current(change, revision.current);
        revision.current = res.revision;
        sending.current = {};
        if (!stopped.current) keep();
        setSavedAt(new Date(res.updatedAt));
        setRejection(null);
        setState(Object.keys(pending.current).length ? 'dirty' : 'saved');
      } catch (e) {
        // Newer changes made meanwhile win over the failed ones.
        pending.current = { ...change, ...pending.current };
        sending.current = {};
        // The copy on the device stays as it is: the conflict is shown when the draft is opened again.
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
        setState(noStore.current ? 'error' : 'local');
        timer.current = setTimeout(() => void save(), RETRY_DELAY);
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (!stopped.current && !held.current && Object.keys(pending.current).length && !timer.current) await save();
  }, [keep]);

  const change = useCallback(
    (c: Partial<C>) => {
      if (stopped.current) return;
      pending.current = { ...pending.current, ...c };
      held.current = false;
      keep();
      setState((s) => (s === 'saving' || s === 'error' || s === 'local' ? s : 'dirty'));
      clearTimer();
      timer.current = setTimeout(() => void save(), SAVE_DELAY);
    },
    [save, keep],
  );

  /** Save now (leaving the page, publishing); true — everything is on the server. */
  const flush = useCallback(async () => {
    await save();
    return !stopped.current && !held.current && !inFlight.current && Object.keys(pending.current).length === 0;
  }, [save]);

  /** Drop what is not saved, here and on the device, and stop (the draft is published, deleted, or the latest version is taken). */
  const cancel = useCallback(() => {
    clearTimer();
    pending.current = {};
    stopped.current = true;
    if (where.current) void deleteDraft(where.current.key);
  }, []);

  // Changes kept last time go at once.
  const sendRestored = useRef(!!restored);
  useEffect(() => {
    if (!sendRestored.current) return;
    sendRestored.current = false;
    void save();
  }, [save]);

  // The connection is back: a save waiting for its retry goes now.
  useEffect(() => {
    const retry = () => {
      if (timer.current && !inFlight.current) void save();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [save]);

  // Leaving the editor inside the app — save at once; closing the tab with
  // changes neither on the server nor on the device — the browser asks.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (atRisk()) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      void save();
    };
  }, [save]);

  return { state, savedAt, rejection, change, flush, cancel, revision: () => revision.current };
}
