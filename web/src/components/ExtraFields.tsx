import type { FieldDef } from '../api/types';
import { itemTitle, useDictionary } from '../lib/dictionaries';
import { FIELD_LIMITS, choiceKeys, type FormValue } from '../lib/fields';
import { formatDate } from '../lib/format';
import { DictSelect } from './DictSelect';
import { DictChip } from './Palette';
import { ErrorMessage } from './ui';
import { errorOf } from '../errors/messages';
import s from './ExtraFields.module.css';

/**
 * Inputs of the open extra fields of a record type («Налаштування полів»),
 * one widget per field type. Archived fields are not offered: their values stay.
 */
export function ExtraInputs(props: {
  idPrefix: string;
  defs: FieldDef[];
  values: Record<string, FormValue>;
  onChange: (key: string, v: FormValue) => void;
}) {
  const open = props.defs.filter((d) => !d.archived);
  if (open.length === 0) return null;
  return (
    <div className={s.inputs}>
      {open.map((def) => (
        <ExtraInput
          key={def.key}
          id={`${props.idPrefix}-${def.key}`}
          def={def}
          value={props.values[def.key] ?? ''}
          onChange={(v) => props.onChange(def.key, v)}
        />
      ))}
    </div>
  );
}

function ExtraInput({ id, def, value, onChange }: { id: string; def: FieldDef; value: FormValue; onChange: (v: FormValue) => void }) {
  const label = `${def.label}${def.required ? ' *' : ''}`;
  if (def.type === 'bool') {
    return (
      <label className={s.check}>
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (def.type === 'list<enum>') {
    return <ItemsInput id={id} def={def} label={label} value={Array.isArray(value) ? value : []} onChange={onChange} />;
  }
  const text = typeof value === 'string' ? value : '';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {def.type === 'enum' ? (
        <DictSelect id={id} dictionary={def.dictionary!} value={text} onChange={onChange} newLabel="+ Новий пункт…" clearable={!def.required} />
      ) : def.type === 'int' || def.type === 'decimal' ? (
        <input
          id={id}
          type="number"
          inputMode={def.type === 'int' ? 'numeric' : 'decimal'}
          step={def.type === 'int' ? 1 : 0.01}
          min={def.min ?? undefined}
          max={def.max ?? undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : def.type === 'date' ? (
        <input id={id} type="date" value={text} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} maxLength={def.maxLength ?? FIELD_LIMITS.textDefault} value={text} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Several dictionary items: a checkbox each; no more than maxItems. */
function ItemsInput(props: { id: string; def: FieldDef; label: string; value: string[]; onChange: (v: string[]) => void }) {
  const dict = useDictionary(props.def.dictionary);
  const max = props.def.maxItems ?? FIELD_LIMITS.itemsDefault;
  const items = (dict.data?.items ?? []).filter((i) => !i.archived || props.value.includes(i.key));
  const toggle = (key: string, on: boolean) =>
    props.onChange(on ? [...props.value, key] : props.value.filter((k) => k !== key));
  return (
    <fieldset className={s.items} id={props.id}>
      <legend>{props.label}</legend>
      {dict.isPending ? (
        <span className="hint">Завантаження…</span>
      ) : items.length === 0 ? (
        <span className="hint">У довіднику ще немає пунктів.</span>
      ) : (
        items.map((i) => {
          const on = props.value.includes(i.key);
          return (
            <label key={i.key} className={s.check}>
              <input type="checkbox" checked={on} disabled={!on && props.value.length >= max} onChange={(e) => toggle(i.key, e.target.checked)} />
              <DictChip title={i.archived ? `${i.title} (в архіві)` : i.title} color={i.color} />
            </label>
          );
        })
      )}
      <ErrorMessage text={dict.isError ? errorOf(dict.error) : null} />
    </fieldset>
  );
}

/**
 * Filled extra fields as rows of a description list (<dl>), archived ones too:
 * the record keeps their values.
 */
export function ExtraFacts({ defs, extra }: { defs: FieldDef[]; extra: Record<string, unknown> }) {
  return (
    <>
      {defs
        .filter((d) => extra[d.key] !== undefined && extra[d.key] !== null)
        .map((d) => (
          <div key={d.key}>
            <dt>{d.label}</dt>
            <dd>
              <FactValue def={d} value={extra[d.key]} />
            </dd>
          </div>
        ))}
    </>
  );
}

function FactValue({ def, value }: { def: FieldDef; value: unknown }) {
  const dict = useDictionary(def.dictionary);
  switch (def.type) {
    case 'bool':
      return <>{value ? 'Так' : 'Ні'}</>;
    case 'date':
      return <>{formatDate(new Date(`${String(value)}T12:00:00Z`))}</>;
    case 'enum':
    case 'list<enum>':
      return (
        <span className={s.chips}>
          {choiceKeys(value).map((k) => {
            const item = dict.data?.items.find((i) => i.key === k);
            return <DictChip key={k} title={itemTitle(dict.data, k)} color={item?.color ?? 'gray'} />;
          })}
        </span>
      );
    case 'decimal':
      return <>{String(value).replace('.', ',')}</>;
    default:
      return <>{String(value)}</>;
  }
}
