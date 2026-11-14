import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { ExtraFieldType, FieldDef } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Card, ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { DICTIONARIES_KEY, useDictionaries } from '../../lib/dictionaries';
import { FIELD_LIMITS, FIELD_TYPE_LABEL, isChoice, recordsKey, useFieldDefs } from '../../lib/fields';
import s from './dictionaries.module.css';

const TYPES = Object.keys(FIELD_TYPE_LABEL) as ExtraFieldType[];

/** /panel/fields/:type: extra fields of a record type — order, bounds, archive (staff). */
export function FieldsPage() {
  const { type = '' } = useParams();
  const schema = useQuery({
    queryKey: [...recordsKey(type), 'schema'],
    queryFn: () => unwrap(api.GET('/api/records/{type}/schema', { params: { path: { type } } })),
  });
  const defs = useFieldDefs(type);

  return (
    <>
      <Link to="/panel" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Панель керування
      </Link>
      <PageHeader title={schema.data ? `Налаштування полів: ${schema.data.label}` : 'Налаштування полів'} />
      {defs.isPending ? <Skeleton height={240} /> : defs.isError ? <ErrorMessage text={errorOf(defs.error)} /> : <Content type={type} defs={defs.data} />}
    </>
  );
}

function useDone(type: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: recordsKey(type) });
    // A dictionary of a field cannot be deleted: its «required» flag changes.
    void qc.invalidateQueries({ queryKey: DICTIONARIES_KEY });
  };
}

function Content({ type, defs }: { type: string; defs: FieldDef[] }) {
  const done = useDone(type);
  const reorder = useMutation({
    mutationFn: (keys: string[]) => unwrap(api.PUT('/api/records/{type}/field-defs/order', { params: { path: { type } }, body: { keys } })),
    onSuccess: done,
  });
  const active = defs.filter((d) => !d.archived);
  const archived = defs.filter((d) => d.archived);
  // The order covers every field; archived ones keep their place at the end.
  const move = (index: number, by: -1 | 1) => {
    const keys = active.map((d) => d.key);
    [keys[index], keys[index + by]] = [keys[index + by]!, keys[index]!];
    reorder.mutate([...keys, ...archived.map((d) => d.key)]);
  };

  return (
    <div className={s.stack}>
      <p className="hint">
        Поля з'являються у формі, на сторінці запису й у фільтрах дошки. Перше поле «Вибір з довідника» фарбує картки в колір пункту.
      </p>
      <Card>
        <h2 className={s.caption}>Поля</h2>
        {active.length === 0 ? (
          <p className="hint">Додаткових полів ще немає. Додайте перше нижче.</p>
        ) : (
          <ul className={s.rows} aria-label="Поля">
            {active.map((def, index) => (
              <li key={def.key}>
                <FieldRow
                  type={type}
                  def={def}
                  busy={reorder.isPending}
                  onUp={index > 0 ? () => move(index, -1) : undefined}
                  onDown={index < active.length - 1 ? () => move(index, 1) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
        <ErrorMessage text={reorder.error ? errorOf(reorder.error) : null} />
      </Card>
      <NewField type={type} />
      {archived.length > 0 && (
        <Card>
          <h2 className={s.caption}>В архіві</h2>
          <p className="hint">Їх не заповнюють у нових записах; у старих значення лишаються.</p>
          <ul className={s.rows} aria-label="В архіві">
            {archived.map((def) => (
              <li key={def.key}>
                <FieldRow type={type} def={def} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** «Вибір з довідника · Тип ТЗ · обов'язкове» */
function Summary({ def }: { def: FieldDef }) {
  const dicts = useDictionaries().data;
  const parts = [FIELD_TYPE_LABEL[def.type]];
  if (def.dictionary) parts.push(dicts?.find((d) => d.key === def.dictionary)?.title ?? def.dictionary);
  if (def.required) parts.push("обов'язкове");
  return <span className={s.sub}>{parts.join(' · ')}</span>;
}

function FieldRow(props: { type: string; def: FieldDef; busy?: boolean; onUp?: () => void; onDown?: () => void }) {
  const { def } = props;
  const done = useDone(props.type);
  const [editing, setEditing] = useState(false);
  const path = { params: { path: { type: props.type, key: def.key } } };
  const update = useMutation({
    mutationFn: (body: Partial<FieldValues> & { archived?: boolean }) =>
      unwrap(api.PATCH('/api/records/{type}/field-defs/{key}', { ...path, body })),
    onSuccess: () => {
      setEditing(false);
      done();
    },
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/records/{type}/field-defs/{key}', path)),
    onSuccess: done,
  });
  const busy = props.busy || update.isPending || remove.isPending;
  const error = update.error ?? remove.error;
  const deleteButton = (
    <ConfirmButton label="Видалити" question={`Видалити поле «${def.label}»?`} danger disabled={busy} onConfirm={() => remove.mutate()} />
  );

  return (
    <div className={`${s.row} ${def.archived ? s.archived : ''}`}>
      <span className={s.fieldMain}>
        <span className={s.title}>{def.label}</span>
        <Summary def={def} />
      </span>
      {def.archived ? (
        <span className={s.actions}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => update.mutate({ archived: false })}>
            Повернути
          </button>
          {deleteButton}
        </span>
      ) : (
        !editing && (
          <span className={s.actions}>
            <button type="button" className={`btn btn-ghost ${s.icon}`} aria-label={`«${def.label}» вище`} disabled={busy || !props.onUp} onClick={props.onUp}>
              <Icon name="up" size={20} />
            </button>
            <button type="button" className={`btn btn-ghost ${s.icon}`} aria-label={`«${def.label}» нижче`} disabled={busy || !props.onDown} onClick={props.onDown}>
              <Icon name="down" size={20} />
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              Змінити
            </button>
          </span>
        )
      )}
      {editing && (
        <FieldForm
          id={`field-${def.key}`}
          def={def}
          type={def.type}
          submitText="Зберегти"
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => update.mutate(v)}
          actions={
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => update.mutate({ archived: true })}>
                В архів
              </button>
              {deleteButton}
            </>
          }
        />
      )}
      <ErrorMessage text={error ? errorOf(error) : null} />
    </div>
  );
}

function NewField({ type }: { type: string }) {
  const done = useDone(type);
  const [form, setForm] = useState(0);
  const [kind, setKind] = useState<ExtraFieldType>('enum');
  const [dictionary, setDictionary] = useState('');
  const dicts = useDictionaries();
  const add = useMutation({
    mutationFn: ({ min, max, ...rest }: FieldValues) =>
      unwrap(
        api.POST('/api/records/{type}/field-defs', {
          params: { path: { type } },
          body: {
            ...rest,
            // Creating sends only the bounds that are set.
            ...(min != null ? { min } : {}),
            ...(max != null ? { max } : {}),
            type: kind,
            ...(isChoice({ type: kind }) ? { dictionary } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setForm((n) => n + 1); // a fresh empty form for the next field
      done();
    },
  });
  const choice = isChoice({ type: kind });

  return (
    <Card>
      <h2 className={s.caption}>Додати поле</h2>
      <FieldForm
        key={form}
        id="field-new"
        type={kind}
        submitText="Додати"
        busy={add.isPending}
        blocked={choice && !dictionary}
        onSubmit={(v) => add.mutate(v)}
      >
        <div className="field">
          <label htmlFor="field-new-type">Тип</label>
          <select id="field-new-type" value={kind} onChange={(e) => setKind(e.target.value as ExtraFieldType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {choice && (
          <div className="field">
            <label htmlFor="field-new-dict">Довідник</label>
            <select id="field-new-dict" value={dictionary} disabled={dicts.isPending} onChange={(e) => setDictionary(e.target.value)}>
              <option value="" disabled>
                {dicts.isPending ? 'Завантаження…' : 'Виберіть…'}
              </option>
              {dicts.data?.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.title}
                </option>
              ))}
            </select>
            <p className="hint">
              Значення поля — пункти довідника з кольорами. Немає потрібного — створіть його в{' '}
              <Link to="/panel/dictionaries">«Довідниках»</Link>.
            </p>
          </div>
        )}
      </FieldForm>
      <ErrorMessage text={add.error ? errorOf(add.error) : null} />
    </Card>
  );
}

type FieldValues = { label: string; required: boolean; min?: number | null; max?: number | null; maxLength?: number; maxItems?: number };

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/**
 * Label, «обов'язкове» and the bounds that suit the type. `children` — type and
 * dictionary, chosen only when the field is created; `actions` — more buttons.
 */
function FieldForm(props: {
  id: string;
  def?: FieldDef;
  type: ExtraFieldType;
  submitText: string;
  busy: boolean;
  blocked?: boolean;
  onCancel?: () => void;
  onSubmit: (v: FieldValues) => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const d = props.def;
  const [label, setLabel] = useState(d?.label ?? '');
  const [required, setRequired] = useState(d?.required ?? false);
  const [min, setMin] = useState(d?.min?.toString() ?? '');
  const [max, setMax] = useState(d?.max?.toString() ?? '');
  const [maxLength, setMaxLength] = useState(d?.maxLength?.toString() ?? '');
  const [maxItems, setMaxItems] = useState(d?.maxItems?.toString() ?? '');
  const numeric = props.type === 'int' || props.type === 'decimal';
  const lo = num(min);
  const hi = num(max);
  const bad =
    (numeric && ((lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi)) || (lo !== null && hi !== null && lo > hi))) ||
    (props.type === 'text' && maxLength !== '' && !(Number.isInteger(Number(maxLength)) && Number(maxLength) >= 1 && Number(maxLength) <= FIELD_LIMITS.textMax)) ||
    (props.type === 'list<enum>' && maxItems !== '' && !(Number.isInteger(Number(maxItems)) && Number(maxItems) >= 1 && Number(maxItems) <= FIELD_LIMITS.itemsMax));

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const v: FieldValues = { label: label.trim(), required };
    if (numeric) {
      v.min = lo;
      v.max = hi;
    }
    if (props.type === 'text' && maxLength !== '') v.maxLength = Number(maxLength);
    if (props.type === 'list<enum>' && maxItems !== '') v.maxItems = Number(maxItems);
    props.onSubmit(v);
  };

  return (
    <form className={s.form} onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${props.id}-label`}>Назва</label>
        <input id={`${props.id}-label`} required maxLength={100} placeholder={d ? undefined : 'Тип'} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      {props.children}
      {numeric && (
        <div className={s.pair}>
          <div className="field">
            <label htmlFor={`${props.id}-min`}>Найменше</label>
            <input id={`${props.id}-min`} type="number" step={props.type === 'int' ? 1 : 0.01} value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${props.id}-max`}>Найбільше</label>
            <input id={`${props.id}-max`} type="number" step={props.type === 'int' ? 1 : 0.01} value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
        </div>
      )}
      {props.type === 'text' && (
        <div className="field">
          <label htmlFor={`${props.id}-len`}>Найбільше символів</label>
          <input
            id={`${props.id}-len`}
            type="number"
            min={1}
            max={FIELD_LIMITS.textMax}
            placeholder={String(FIELD_LIMITS.textDefault)}
            value={maxLength}
            onChange={(e) => setMaxLength(e.target.value)}
          />
        </div>
      )}
      {props.type === 'list<enum>' && (
        <div className="field">
          <label htmlFor={`${props.id}-items`}>Найбільше пунктів</label>
          <input
            id={`${props.id}-items`}
            type="number"
            min={1}
            max={FIELD_LIMITS.itemsMax}
            placeholder={String(FIELD_LIMITS.itemsDefault)}
            value={maxItems}
            onChange={(e) => setMaxItems(e.target.value)}
          />
        </div>
      )}
      <label className={s.check}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Обов'язкове
      </label>
      {d && (
        <p className="hint">
          {FIELD_TYPE_LABEL[d.type]}: тип{d.dictionary ? ' і довідник' : ''} не змінюються. Нові межі діють для нових значень.
        </p>
      )}
      <div className={s.formActions}>
        <button type="submit" className="btn btn-primary" disabled={props.busy || !label.trim() || bad || props.blocked}>
          {props.submitText}
        </button>
        {props.onCancel && (
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            Скасувати
          </button>
        )}
        {props.actions}
      </div>
    </form>
  );
}
