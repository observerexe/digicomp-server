import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';
import type { ExtraFieldType, FieldDef } from '../api/types';

/** Queries of one record type (schema, extra fields): invalidate all at once. */
export const recordsKey = (type: string) => ['records', type] as const;

export const FIELD_TYPE_LABEL: Record<ExtraFieldType, string> = {
  text: 'Текст',
  int: 'Ціле число',
  decimal: 'Дробове число',
  date: 'Дата',
  bool: 'Так / ні',
  enum: 'Вибір з довідника',
  'list<enum>': 'Кілька з довідника',
};

/** Server defaults (api/src/records/extra-values.ts, EXTRA_LIMITS). */
export const FIELD_LIMITS = { textDefault: 200, textMax: 1000, itemsDefault: 10, itemsMax: 50, bound: 1e9 } as const;

/** Extra fields of a record type, archived too, in order. Every role reads them. */
export function useFieldDefs(type: string) {
  return useQuery({
    queryKey: [...recordsKey(type), 'field-defs'],
    queryFn: () => unwrap(api.GET('/api/records/{type}/field-defs', { params: { path: { type } } })),
    staleTime: 5 * 60_000,
  });
}

export const isChoice = (d: Pick<FieldDef, 'type'>) => d.type === 'enum' || d.type === 'list<enum>';

/** Item keys a choice field holds in a record: none, one or several. */
export function choiceKeys(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The field that colours task cards: the first open «Вибір з довідника». */
export const stripeField = (defs: FieldDef[] | undefined) => defs?.find((d) => d.type === 'enum' && !d.archived);

/** Fields the board filters by: open choice fields. */
export const filterFields = (defs: FieldDef[] | undefined) => (defs ?? []).filter((d) => isChoice(d) && !d.archived);

/** Every chosen filter (field key → item key) is held by the record. */
export function matchesFilters(extra: Record<string, unknown>, filters: Record<string, string | null>): boolean {
  return Object.entries(filters).every(([key, item]) => item === null || choiceKeys(extra[key]).includes(item));
}
