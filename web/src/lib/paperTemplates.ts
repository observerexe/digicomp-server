import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
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

/** Which templates: those that create records of a type, or whose documents may be about a record of a type. */
export type TemplateFilter = { creates: RecordType } | { about: RecordType };

const fits = (t: TemplateItem, filter: TemplateFilter | undefined) =>
  !filter || ('creates' in filter ? t.kind === 'creates' && t.target === filter.creates : t.about.includes(filter.about));

/**
 * Templates a new document can be made from, as choices (see TemplateFilter).
 * A template whose bindings broke stays in the list, not chosen.
 */
export function templateChoices(list: TemplateItem[] | undefined, filter?: TemplateFilter): Choice[] {
  return (list ?? [])
    .filter((t) => t.currentVersion !== null && !t.archived && fits(t, filter))
    .map((t) => ({ id: t.id, title: t.title, ...(t.needsUpdate ? { disabledNote: 'Шаблон потребує оновлення' } : {}) }));
}

/**
 * A new document from a template, opened in the editor; `about` — the record
 * it is about (the server puts it in the template's field of its type).
 */
export function useNewPaper() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (body: { templateId: string; about?: { type: RecordType; id: string } }) => unwrap(api.POST('/api/papers', { body })),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['papers', 'list'] });
      void navigate(`/editor/${p.id}`);
    },
  });
}

/**
 * A document for a record made before documents: published at once from the
 * record, opened in the editor; `section` — the query key of the record's section.
 */
export function usePaperForRecord(section: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (body: { templateId: string; targetId: string }) => unwrap(api.POST('/api/papers/for-record', { body })),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['papers', 'list'] });
      void qc.invalidateQueries({ queryKey: [section] });
      void navigate(`/editor/${p.id}`);
    },
  });
}
