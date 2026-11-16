import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap } from '../api/client';
import type { LinkCandidate, RecordType } from '../api/types';

/** A record as a reference shows it: title, archived, QR code. */
export type RecordView = { type: RecordType; id: string; title: string; archived: boolean; code?: string };

/** Every record type (as the API knows them), in the order of lists. */
export const RECORD_TYPES = [
  'user',
  'task',
  'project',
  'place',
  'inventory_item',
  'inventory_writeoff',
  'discipline_record',
  'points_entry',
  'session',
  'fault',
  'place_authorization',
  'document',
  'paper',
] as const satisfies readonly RecordType[];
// A type the API adds and this list does not have — an error here.
const allTypes: Exclude<RecordType, (typeof RECORD_TYPES)[number]> extends never ? true : false = true;
void allTypes;

/** What a record of each type is called (one), for chips, groups and hints; a new type without a name — a type error. */
export const RECORD_LABEL: Record<RecordType, string> = {
  user: 'Учасник',
  document: 'Документ',
  paper: 'Документ редактора',
  task: 'ТЗ',
  project: 'Проєкт',
  place: 'Обладнання',
  inventory_item: 'Склад',
  inventory_writeoff: 'Списання зі складу',
  discipline_record: 'Стягнення',
  points_entry: 'Нарахування балів',
  session: 'Сеанс роботи',
  fault: 'Несправність',
  place_authorization: 'Допуск до обладнання',
};

export const recordLabel = (type: RecordType) => RECORD_LABEL[type];

/** Page of a record; equipment and inventory open by their QR code, a fault — on its equipment's page. */
export function recordHref(type: RecordType, id: string, code?: string) {
  switch (type) {
    case 'user':
      return `/team/${id}`;
    case 'document':
      return `/docs/${id}`;
    case 'paper':
      return `/editor/${id}`;
    case 'task':
      return `/tasks/${id}`;
    case 'project':
      return `/projects/${id}`;
    case 'place':
      return `/lab/${encodeURIComponent(code ?? id)}`;
    case 'inventory_item':
      return `/inventory/${encodeURIComponent(code ?? id)}`;
    case 'fault':
      return code ? `/lab/${encodeURIComponent(code)}#faults` : null;
    default:
      return null;
  }
}

/** The value after it stopped changing for `ms` (search as you type). */
export function useSettled<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Records of a type the actor sees whose title (or code) has `q`: up to 20, by title. */
export const candidatesQuery = (type: RecordType, q: string) => ({
  queryKey: ['links', 'candidates', type, q] as const,
  queryFn: (): Promise<LinkCandidate[]> => unwrap(api.GET('/api/links/candidates', { params: { query: { type, ...(q ? { q } : {}) } } })),
  placeholderData: keepPreviousData,
});

export function useCandidates(type: RecordType, q: string, enabled = true) {
  return useQuery({ ...candidatesQuery(type, q), enabled });
}
