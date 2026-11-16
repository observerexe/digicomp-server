import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../api/client';
import type { LinkCandidate, RecordLink, RecordType } from '../api/types';
import { errorOf } from '../errors/messages';
import { templateChoices, useTemplates } from '../lib/paperTemplates';
import { recordHref, recordLabel, useCandidates, useSettled } from '../lib/records';
import { NewReport } from './NewReport';
import { SearchField } from './Filters';
import { Card, ErrorMessage, Skeleton } from './ui';
import s from './Related.module.css';

/** Groups of the «Пов'язане» block, in order: documents first. */
const GROUPS: { title: string; types: RecordType[] }[] = [
  { title: 'Документи', types: ['document', 'paper'] },
  { title: 'ТЗ', types: ['task'] },
  { title: 'Проєкти', types: ['project'] },
  { title: 'Обладнання', types: ['place'] },
  { title: 'Склад', types: ['inventory_item'] },
  { title: 'Несправності', types: ['fault'] },
];

/** What can be picked to link, one chip per type. */
const LINKABLE: RecordType[] = ['document', 'task', 'project', 'place', 'inventory_item', 'fault'];

export const linksKey = (type: RecordType, id: string) => ['links', type, id] as const;

/**
 * «Пов'язане»: records linked with this one, grouped by type. Whoever edits
 * the record links it to others and removes its links; «Новий документ» —
 * a report about it (its templates the reader may make documents from).
 */
export function Related({ type, id }: { type: RecordType; id: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: linksKey(type, id),
    queryFn: () => unwrap(api.GET('/api/links', { params: { query: { type, id } } })),
  });
  // Both sides show the link, so every list of links refreshes.
  const refresh = () => void qc.invalidateQueries({ queryKey: ['links'] });
  const add = useMutation({
    mutationFn: (c: LinkCandidate) =>
      unwrap(
        api.POST('/api/links', {
          body: { fromType: type, fromId: id, toType: c.type, toId: c.id },
        }),
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (linkId: string) => unwrap(api.DELETE('/api/links/{id}', { params: { path: { id: linkId } } })),
    onSuccess: refresh,
  });
  const reports = templateChoices(useTemplates().data, { report: type });

  if (q.isPending) return null;
  if (q.isError) {
    return (
      <Card>
        <h2 className={s.caption}>Пов’язане</h2>
        <ErrorMessage text={errorOf(q.error)} />
      </Card>
    );
  }
  const { canLink, items } = q.data;
  if (!items.length && !canLink && !reports.length) return null;
  const groups = GROUPS.map((g) => ({
    ...g,
    items: items.filter((l) => g.types.includes(l.type)),
  })).filter((g) => g.items.length);

  return (
    <Card>
      <div className={s.head}>
        <h2 className={s.caption}>Пов’язане</h2>
        <span className={s.headActions}>
          <NewReport type={type} id={id} />
          {canLink && !adding && (
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}>
              Пов’язати
            </button>
          )}
        </span>
      </div>
      {items.length === 0 && !adding && <p className="hint">Ще нічого не пов’язано.</p>}
      {groups.map((g) => (
        <section key={g.title} className={s.group} aria-label={g.title}>
          <h3 className={s.groupTitle}>{g.title}</h3>
          <ul className={s.rows}>
            {g.items.map((l) => (
              <li key={l.id} className={s.row}>
                <RecordRef link={l} />
                {l.canRemove && (
                  <button type="button" className="btn btn-ghost" aria-label={`Прибрати зв’язок з «${l.title}»`} disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {adding && (
        <LinkPicker
          exclude={[{ type, id }, ...items.map((l) => ({ type: l.type, id: l.recordId }))]}
          busy={add.isPending}
          onPick={(c) => add.mutate(c)}
          onClose={() => setAdding(false)}
        />
      )}
      <ErrorMessage text={add.isError ? errorOf(add.error) : remove.isError ? errorOf(remove.error) : null} />
    </Card>
  );
}

function RecordRef({ link: l }: { link: RecordLink }) {
  const href = recordHref(l.type, l.recordId, l.code);
  return (
    <span className={s.main}>
      {href ? (
        <Link to={href} className={s.title}>
          {l.title}
        </Link>
      ) : (
        <span className={s.title}>{l.title}</span>
      )}
      {l.archived && <span className={s.sub}>в архіві</span>}
    </span>
  );
}

/**
 * Finds a record to link: type chips, search by title or code, results.
 * Records in `exclude` (this one and the already linked) are not offered.
 */
export function LinkPicker(props: { exclude: { type: RecordType; id: string }[]; busy?: boolean; onPick: (c: LinkCandidate) => void; onClose: () => void }) {
  const [type, setType] = useState<RecordType>('document');
  const [text, setText] = useState('');
  const search = useSettled(text.trim());
  const found = useCandidates(type, search);
  const shown = found.data?.filter((c) => c.type === type && !props.exclude.some((e) => e.type === c.type && e.id === c.id)) ?? [];

  return (
    // Enter in the search must not submit the form the picker sits in.
    <div
      className={s.picker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
    >
      <div className={s.chips} role="group" aria-label="Що пов’язати">
        {LINKABLE.map((t) => (
          <button key={t} type="button" className={s.chip} aria-pressed={type === t} onClick={() => setType(t)}>
            {recordLabel(t)}
          </button>
        ))}
      </div>
      <SearchField value={text} onChange={setText} placeholder="Назва або код" />
      {found.isPending ? (
        <Skeleton height={48} />
      ) : found.isError ? (
        <ErrorMessage text={errorOf(found.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">Нічого не знайдено.</p>
      ) : (
        <ul className={s.found} aria-label="Знайдено">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" className={s.pick} disabled={props.busy} onClick={() => props.onPick(c)}>
                <span className={s.title}>{c.title}</span>
                {(c.code || c.archived) && <span className={s.sub}>{[c.code, c.archived && 'в архіві'].filter(Boolean).join(' · ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-ghost" onClick={props.onClose}>
        Готово
      </button>
    </div>
  );
}
