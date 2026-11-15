import type { PaperField, PaperTemplateRef } from '../api/types';
import { valueText, type FieldValue, type FieldValues } from '../../../shared/editor-schema/fields';
import { fieldType } from './fieldTypes';
import { usePaperRecords } from './records';
import s from './FieldsPanel.module.css';

/** id of a field's control in the panel (a click on the sheet focuses it). */
export const fieldControlId = (key: string) => `pf-${key}`;

/** A field is filled: a value, or text in its zone. */
export function isFilled(f: PaperField, values: FieldValues, zones: Record<string, string>) {
  return f.type === 'richtext' ? !!zones[f.key]?.trim() : values[f.key] !== undefined;
}

/** How much of what the actor fills is filled, what required is still empty. */
export function fillProgress(template: PaperTemplateRef, values: FieldValues, zones: Record<string, string>) {
  const mine = template.fields.filter((f) => f.canFill);
  const required = mine.filter((f) => f.required);
  return {
    total: mine.length,
    filled: mine.filter((f) => isFilled(f, values, zones)).length,
    required: required.length,
    requiredFilled: required.filter((f) => isFilled(f, values, zones)).length,
    missing: required.filter((f) => !isFilled(f, values, zones)),
  };
}

/**
 * fill — a draft the actor fills; change — a published document the actor
 * changes (fields «можна змінити»); view — reading.
 */
export type FieldsMode = 'fill' | 'change' | 'view';

/** What an auto field shows before the record has it. */
export const autoPlaceholder = (published: boolean) => (published ? 'ще немає' : 'після публікації');

export type GroupsProps = {
  template: PaperTemplateRef;
  values: FieldValues;
  /** Text of each zone on the sheet. */
  zones: Record<string, string>;
  mode: FieldsMode;
  /** Published (or later): auto fields show the record. */
  published: boolean;
  active: string | null;
  onChange: (key: string, value: FieldValue | null) => void;
  onActive: (key: string | null) => void;
  /** A zone: to it on the sheet. */
  onJump: (key: string) => void;
  /** The phone's form: zones are written here (plain) or shown (with formatting). */
  onZoneText?: (key: string, text: string) => void;
};

/**
 * A draft: fields the actor fills, then those a moderator fills; a change:
 * those that may change, then the rest; reading — all in one list. Auto
 * fields last: «Підставить система».
 */
export function FieldGroups({ template, values, zones, mode, published, active, onChange, onActive, onJump, onZoneText }: GroupsProps) {
  const auto = template.fields.filter((f) => f.auto);
  const rest = template.fields.filter((f) => !f.auto);
  // The actor's own: what they fill now, and author fields they cannot (a reference to a type without a picker).
  const own = rest.filter((f) => (mode === 'fill' ? f.canFill || f.fill === 'author' : f.canFill));
  const others = rest.filter((f) => !own.includes(f));
  const sections: [string | null, PaperField[]][] =
    mode === 'fill'
      ? [
          ['Заповнюєте ви', own],
          ['Заповнить модератор', others],
        ]
      : mode === 'change'
        ? [
            ['Можна змінити', own],
            ['Не змінюється', others],
          ]
        : [[auto.length ? 'Поля' : null, rest]];

  const row = (f: PaperField) => {
    const { Widget, group } = fieldType(f.type);
    const id = fieldControlId(f.key);
    const label = (
      <>
        {f.label}
        {f.required && <span aria-hidden="true"> *</span>}
      </>
    );
    const zone = onZoneText && f.type === 'richtext' ? { text: zones[f.key] ?? '', write: (t: string) => onZoneText(f.key, t) } : undefined;
    return (
      <div
        key={f.key}
        className={`field ${s.row} ${active === f.key ? s.active : ''} ${f.required && !isFilled(f, values, zones) && f.canFill ? s.missingRow : ''}`}
        onFocus={() => onActive(f.key)}
      >
        {group || (f.type === 'richtext' && !(zone && f.plain)) ? <span className={s.label}>{label}</span> : <label htmlFor={id}>{label}</label>}
        <Widget id={id} field={f} value={values[f.key]} disabled={!f.canFill} onChange={(v) => onChange(f.key, v)} onJump={() => onJump(f.key)} zone={zone} />
      </div>
    );
  };

  return (
    <>
      {sections.map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title ?? ''} className={s.group}>
              {title && <h3>{title}</h3>}
              {list.map(row)}
            </section>
          ),
      )}
      {auto.length > 0 && (
        <section className={s.group}>
          <h3>Підставить система</h3>
          {auto.map((f) => (
            <AutoRow key={f.key} field={f} value={values[f.key]} published={published} />
          ))}
        </section>
      )}
    </>
  );
}

/** An auto field: what the record holds, or when it comes. */
function AutoRow({ field: f, value, published }: { field: PaperField; value: FieldValue | undefined; published: boolean }) {
  const records = usePaperRecords();
  const text = value !== undefined ? valueText(f.type, value, f.options, (type, id) => records.get(type, id)?.title ?? null) : null;
  return (
    <div className={s.autoRow}>
      <span>{f.label}</span>
      <span className={text === null ? s.later : undefined}>{text ?? autoPlaceholder(published)}</span>
    </div>
  );
}

/**
 * «Поля» (from 900 px): the template, how much is filled, what is still
 * missing; fields the actor fills, then those a moderator fills.
 */
export function FieldsPanel(props: Omit<GroupsProps, 'onZoneText'>) {
  const { template, values, zones } = props;
  const editable = props.mode === 'fill';
  const p = fillProgress(template, values, zones);
  return (
    <aside className={s.panel} aria-label="Поля документа">
      <h2 className={s.tab}>Поля</h2>
      <div className={s.body}>
        <div className={s.summary}>
          <span>
            Шаблон «{template.title}» · v{template.version}
          </span>
          {editable && p.total > 0 && (
            <strong>
              {p.filled} з {p.total}
            </strong>
          )}
        </div>
        {editable && p.total > 0 && (
          <div className={s.bar} role="progressbar" aria-label="Заповнено полів" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.filled}>
            <span className={s[`w${Math.round((p.filled / p.total) * 20)}`]} />
          </div>
        )}
        {editable && p.missing.length > 0 && <MissingNote fields={p.missing} />}
        <FieldGroups {...props} />
      </div>
    </aside>
  );
}

export function MissingNote({ fields }: { fields: readonly PaperField[] }) {
  return <p className={s.missing}>Не заповнено: {fields.map((f) => f.label).join(', ')}</p>;
}
