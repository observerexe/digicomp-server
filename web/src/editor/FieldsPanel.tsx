import type { PaperField, PaperTemplateRef } from '../api/types';
import type { FieldValue, FieldValues } from '../../../shared/editor-schema/fields';
import { fieldType } from './fieldTypes';
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

export type GroupsProps = {
  template: PaperTemplateRef;
  values: FieldValues;
  /** Text of each zone on the sheet. */
  zones: Record<string, string>;
  /** The document is a draft the actor may change. */
  editable: boolean;
  active: string | null;
  onChange: (key: string, value: FieldValue | null) => void;
  onActive: (key: string | null) => void;
  /** A zone: to it on the sheet. */
  onJump: (key: string) => void;
  /** The phone's form: zones are written here (plain) or shown (with formatting). */
  onZoneText?: (key: string, text: string) => void;
};

/** Fields the actor fills, then those a moderator fills; a document that is not a draft — all in one list. */
export function FieldGroups({ template, values, zones, editable, active, onChange, onActive, onJump, onZoneText }: GroupsProps) {
  // The actor's own: what they fill now, and author fields they cannot (a reference to a type without a picker).
  const own = template.fields.filter((f) => f.canFill || f.fill === 'author');
  const others = template.fields.filter((f) => !own.includes(f));

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

  if (!editable) return <section className={s.group}>{template.fields.map(row)}</section>;
  return (
    <>
      {own.length > 0 && (
        <section className={s.group}>
          <h3>Заповнюєте ви</h3>
          {own.map(row)}
        </section>
      )}
      {others.length > 0 && (
        <section className={s.group}>
          <h3>Заповнить модератор</h3>
          {others.map(row)}
        </section>
      )}
    </>
  );
}

/**
 * «Поля» (from 900 px): the template, how much is filled, what is still
 * missing; fields the actor fills, then those a moderator fills.
 */
export function FieldsPanel(props: Omit<GroupsProps, 'onZoneText'>) {
  const { template, values, zones, editable } = props;
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
