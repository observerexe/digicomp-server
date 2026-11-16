import { useState } from 'react';
import type { FieldDef, Me } from '../../api/types';
import { Chips, SearchField } from '../../components/Filters';
import { ErrorMessage, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { useDictionary } from '../../lib/dictionaries';
import { filterFields, stripeField, useFieldDefs } from '../../lib/fields';
import { plural } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { useArchive } from './queries';
import { TaskCard } from './TaskCard';
import s from './tasks.module.css';

const NO_DRAG = { draggable: false, onDragStart: () => {}, onDragEnd: () => {} };

/**
 * «Архів»: done tasks moved off the board (by staff or 30 days after
 * acceptance). Search by title, filters by choice fields and year of
 * acceptance — on the server, a page at a time. Cards without buttons:
 * «Повернути з архіву» is on the task's page.
 */
export function TaskArchive({ me }: { me: Me }) {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string | null>>({});
  const q = useDebounced(search.trim(), 300);
  const archive = useArchive({ search: q, year, fields });
  const defs = useFieldDefs('task').data;
  const stripe = stripeField(defs);
  const stripeDict = useDictionary(stripe?.dictionary).data;

  const pages = archive.data?.pages;
  const tasks = pages?.flatMap((p) => p.items);
  const total = pages?.[0]?.total;
  const years = (pages?.[0]?.years ?? []).map((y) => ({ value: String(y), label: String(y) }));
  const filtered = !!q || !!year || Object.values(fields).some(Boolean);

  return (
    <>
      <div className={s.filters}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва технічного завдання" />
        {filterFields(defs).map((f) => (
          <FieldChips key={f.key} def={f} value={fields[f.key] ?? null} onChange={(v) => setFields((x) => ({ ...x, [f.key]: v }))} />
        ))}
        <Chips label="Рік прийняття" options={year && !years.some((y) => y.value === year) ? [...years, { value: year, label: year }] : years} value={year} onChange={setYear} />
      </div>
      <ErrorMessage text={archive.isError ? errorOf(archive.error) : null} />
      {!tasks ? (
        archive.isPending && <Skeleton height={140} />
      ) : tasks.length === 0 ? (
        <p className="hint">{filtered ? 'Нічого не знайдено.' : 'В архіві ще немає технічних завдань.'}</p>
      ) : (
        <>
          <p className="hint">
            {total} {plural(total ?? 0, ['технічне завдання', 'технічні завдання', 'технічних завдань'])}
          </p>
          <div className={s.archiveList}>
            {tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                me={me}
                busy={false}
                onAction={() => {}}
                drag={NO_DRAG}
                returning={false}
                setReturning={() => {}}
                stripe={stripe && typeof t.extra[stripe.key] === 'string' ? stripeDict?.items.find((i) => i.key === t.extra[stripe.key]) : undefined}
              />
            ))}
          </div>
          {archive.hasNextPage && (
            <button type="button" className={`btn btn-ghost ${s.more}`} disabled={archive.isFetchingNextPage} onClick={() => void archive.fetchNextPage()}>
              Показати ще
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Filter by a choice field: every item of its dictionary (the archive is filtered on the server). */
function FieldChips(props: { def: FieldDef; value: string | null; onChange: (v: string | null) => void }) {
  const dict = useDictionary(props.def.dictionary).data;
  const options = (dict?.items ?? []).map((i) => ({ value: i.key, label: i.title }));
  return <Chips label={props.def.label} options={options} value={props.value} onChange={props.onChange} />;
}
