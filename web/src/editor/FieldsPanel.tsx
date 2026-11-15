import type { PaperField, PaperTemplateRef } from '../api/types';
import type { FieldValue, FieldValues } from '../../../shared/editor-schema/fields';
import { fieldType } from './fieldTypes';
import s from './FieldsPanel.module.css';

/** id of a field's control in the panel (a click on the sheet focuses it). */
export const fieldControlId = (key: string) => `pf-${key}`;

/** A field is filled: a value, or text in its zone. */
export function isFilled(f: PaperField, values: FieldValues, zones: Record<string, string>) {
  return f.type === 'richtext' ? !!zones[f.key] : values[f.key] !== undefined;
}

type Props = {
  template: PaperTemplateRef;
  values: FieldValues;
  /** Text of each zone on the sheet. */
  zones: Record<string, string>;
  /** The document is a draft the actor may change. */
  editable: boolean;
  active: string | null;
  onChange: (key: string, value: FieldValue | null) => void;
  onActive: (key: string | null) => void;
  onJump: (key: string) => void;
};

/**
 * «Поля»: the template, how much is filled, what is still missing; fields the
 * actor fills, then those a moderator fills.
 */
export function FieldsPanel({ template, values, zones, editable, active, onChange, onActive, onJump }: Props) {
  // The actor's own: what they fill now, and author fields not fillable yet (pickers).
  const own = template.fields.filter((f) => f.canFill || f.fill === 'author');
  const others = template.fields.filter((f) => !own.includes(f));
  const mine = template.fields.filter((f) => f.canFill);
  const filled = mine.filter((f) => isFilled(f, values, zones)).length;
  const missing = mine.filter((f) => f.required && !isFilled(f, values, zones));

  const row = (f: PaperField) => {
    const { Widget, group } = fieldType(f.type);
    const id = fieldControlId(f.key);
    const label = (
      <>
        {f.label}
        {f.required && <span aria-hidden="true"> *</span>}
      </>
    );
    return (
      <div
        key={f.key}
        className={`field ${s.row} ${active === f.key ? s.active : ''} ${f.required && !isFilled(f, values, zones) && f.canFill ? s.missingRow : ''}`}
        onFocus={() => onActive(f.key)}
      >
        {group ? <span className={s.label}>{label}</span> : <label htmlFor={id}>{label}</label>}
        <Widget id={id} field={f} value={values[f.key]} disabled={!f.canFill} onChange={(v) => onChange(f.key, v)} onJump={() => onJump(f.key)} />
      </div>
    );
  };

  return (
    <aside className={s.panel} aria-label="Поля документа">
      <h2 className={s.tab}>Поля</h2>
      <div className={s.body}>
        <div className={s.summary}>
          <span>
            Шаблон «{template.title}» · v{template.version}
          </span>
          {editable && mine.length > 0 && (
            <strong>
              {filled} з {mine.length}
            </strong>
          )}
        </div>
        {editable && mine.length > 0 && (
          <div className={s.bar} role="progressbar" aria-label="Заповнено полів" aria-valuemin={0} aria-valuemax={mine.length} aria-valuenow={filled}>
            <span className={s[`w${Math.round((filled / mine.length) * 20)}`]} />
          </div>
        )}
        {editable && missing.length > 0 && <p className={s.missing}>Не заповнено: {missing.map((f) => f.label).join(', ')}</p>}
        {editable ? (
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
        ) : (
          <section className={s.group}>{template.fields.map(row)}</section>
        )}
      </div>
    </aside>
  );
}
