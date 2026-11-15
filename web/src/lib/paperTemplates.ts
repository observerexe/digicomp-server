import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';
import type { RecordType, TemplateItem } from '../api/types';
import type { Choice } from '../components/ChoiceButton';

/** Templates the user sees (staff — all, members — those open to them). */
export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: ['paper-templates', 'list'],
    queryFn: () => unwrap(api.GET('/api/papers/templates')),
    enabled,
  });
}

/**
 * Templates a new document can be made from, as choices; `creates` — only
 * those that create records of this type. A template whose bindings broke
 * stays in the list, not chosen.
 */
export function templateChoices(list: TemplateItem[] | undefined, creates?: RecordType): Choice[] {
  return (list ?? [])
    .filter((t) => t.currentVersion !== null && !t.archived && (creates === undefined || (t.kind === 'creates' && t.target === creates)))
    .map((t) => ({ id: t.id, title: t.title, ...(t.needsUpdate ? { disabledNote: 'Шаблон потребує оновлення' } : {}) }));
}
