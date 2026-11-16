import { api, unwrap } from '../api/client';

/**
 * Changes of drafts the server has not received yet, kept on this device
 * (IndexedDB): a document's draft, a template's draft version. One record a
 * draft, written with every change and deleted once the server has it all.
 * The autosave writes them; what an editor no longer holds is sent from here
 * (when the app opens, when the connection is back). Without IndexedDB
 * nothing is kept: everything works as before, from memory.
 */

/** Which draft: a document, or a template's draft version (one at a time per template). */
export type DraftTarget = { kind: 'paper'; id: string } | { kind: 'template'; id: string; v: number };

export type LocalDraft = {
  key: string;
  userId: string;
  target: DraftTarget;
  /** The revision the changes go with. */
  revision: number;
  /** The unsent parts of the draft (title, content, values; body, fields). */
  change: Record<string, unknown>;
  /** When they were kept (ISO). */
  at: string;
};

export const draftKey = (userId: string, target: Pick<DraftTarget, 'kind' | 'id'>) => `${userId}|${target.kind}|${target.id}`;

const DB = 'digicomp';
const STORE = 'drafts';

let opened: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

/** One request in its own transaction; null — no storage or it failed. Transactions run in the order they were asked for. */
async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<{ value: T } | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve({ value: req.result });
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** true — the draft is kept on this device. */
export async function putDraft(draft: LocalDraft): Promise<boolean> {
  return (await request('readwrite', (s) => s.put(draft))) !== null;
}

export async function deleteDraft(key: string): Promise<void> {
  await request('readwrite', (s) => s.delete(key));
}

async function getDraft(key: string): Promise<LocalDraft | null> {
  return ((await request('readonly', (s) => s.get(key)))?.value as LocalDraft | undefined) ?? null;
}

async function allDrafts(): Promise<LocalDraft[]> {
  return ((await request('readonly', (s) => s.getAll()))?.value as LocalDraft[] | undefined) ?? [];
}

/** Logging out: nothing of the person stays on the device. A login: only that person's drafts stay. */
export async function dropDrafts(except?: string): Promise<void> {
  if (except === undefined) {
    await request('readwrite', (s) => s.clear());
    return;
  }
  for (const d of await allDrafts()) if (d.userId !== except) await deleteDraft(d.key);
}

/** Drafts open in an editor: their autosave sends them, not the background. */
const open = new Map<string, number>();
/** Drafts being sent in the background now. */
const sending = new Map<string, Promise<void>>();

/**
 * An editor opens the draft: its kept changes (once the background is done
 * with them), and the background leaves it alone until released.
 */
export async function claimDraft(key: string): Promise<LocalDraft | null> {
  open.set(key, (open.get(key) ?? 0) + 1);
  await sending.get(key);
  return getDraft(key);
}

export function releaseDraft(key: string) {
  const n = (open.get(key) ?? 0) - 1;
  if (n > 0) open.set(key, n);
  else open.delete(key);
}

function send(d: LocalDraft) {
  const body = { revision: d.revision, ...d.change };
  const t = d.target;
  return t.kind === 'paper'
    ? unwrap(api.PATCH('/api/papers/{id}', { params: { path: { id: t.id } }, body }))
    : unwrap(api.PATCH('/api/papers/templates/{id}/versions/{v}', { params: { path: { id: t.id, v: t.v } }, body }));
}

let running: Promise<void> | null = null;

/**
 * Sends the person's kept drafts no editor holds, one by one. Received —
 * deleted; anything else (no connection, the draft changed meanwhile, a
 * refused value) — kept: the editor shows it when the draft is opened.
 */
export function sendDrafts(userId: string): Promise<void> {
  running ??= (async () => {
    try {
      for (const d of await allDrafts()) {
        if (d.userId !== userId || open.has(d.key)) continue;
        const one = send(d).then(
          () => deleteDraft(d.key),
          () => undefined,
        );
        sending.set(d.key, one);
        await one;
        sending.delete(d.key);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** JSON values equal regardless of key order (jsonb does not keep it). */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
