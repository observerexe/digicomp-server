import { useCallback, useEffect, useState } from 'react';
import { claimDraft, deleteDraft, draftKey, releaseDraft, type DraftTarget, type LocalDraft } from '../lib/localDrafts';

/**
 * What this device kept of a draft the server did not receive, read once
 * when its editor opens (the background does not send it meanwhile).
 * `done` — the editor took the changes; `drop` — they are thrown away.
 */
export function useLocalDraft(userId: string | undefined, target: Pick<DraftTarget, 'kind' | 'id'> | null) {
  const key = userId && target ? draftKey(userId, target) : null;
  const [read, setRead] = useState<{ key: string; draft: LocalDraft | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void claimDraft(key).then((draft) => live && setRead({ key, draft }));
    return () => {
      live = false;
      releaseDraft(key);
    };
  }, [key]);
  const done = useCallback(() => setRead((r) => r && { ...r, draft: null }), []);
  const drop = useCallback(() => {
    if (key) void deleteDraft(key);
    done();
  }, [key, done]);
  const mine = read?.key === key;
  return { ready: !key || mine, draft: mine ? (read?.draft ?? null) : null, done, drop };
}
