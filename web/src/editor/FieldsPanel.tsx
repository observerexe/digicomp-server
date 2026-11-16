import type { PaperField, PaperTemplateRef } from '../api/types';
import { isEmptyRow, ROWS, rowsIn, valueText, type Condition, type FieldValue, type FieldValues } from '../../../shared/editor-schema/fields';
import { isOff } from './conditional';
import { fieldType } from './fieldTypes';
import { usePaperRecords } from './records';
import s from './FieldsPanel.module.css';

/** id of a field's control in the panel (a click on the sheet focuses it). */
export const fieldControlId = (key: string) => `pf-${key}`;
/** id of the control of a cell of «Повторювані рядки» (`row` from 0). */
export const cellControlId = (key: string, row: number, column: string) => `pf-${key}-${row}-${column}`;

/**
 * A field is filled: a value, or text in its zone; rows — a row not empty,
 * each such row with its required cells.
 */
export function isFilled(f: PaperField, values: FieldValues, zones: Record<string, string>) {
  if (f.type === 'richtext') return !!zones[f.key]?.trim();
  if (f.type === ROWS) {
    const rows = rowsIn(values[f.key]).filter((r) => !isEmptyRow(r));
    return rows.length > 0 && rows.every((r) => (f.columns ?? []).every((c) => !c.required || r[c.key] !== undefined));
  }
  return values[f.key] !== undefined;
}

/** Fields of conditional blocks: the condition each waits for, by key (conditional.ts conditionsIn). */
export type Conditions = Readonly<Record<string, Condition>>;

/** How much of what the actor fills is filled, what required is still empty; fields of blocks that are off do not count. */
export function fillProgress(template: PaperTemplateRef, values: FieldValues, zones: Record<string, string>, conditions: Conditions = {}) {
  const mine = template.fields.filter((f) => f.canFill && !isOff(f.key, conditions, values));
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


/** A report's record field: its first field referring to the record's type, not bound; null — not a report. */
export function reportRecordKey(template: PaperTemplateRef | null): string | null {
  if (template?.kind !== 'report') return null;
  return template.fields.find((f) => f.type === `ref:${template.target}` && !f.binding)?.key ?? null;
}

/** What an auto field shows before the record has it: `shown` — the record is there (published; a report — chosen). */
export function autoPlaceholder(kind: PaperTemplateRef['kind'], shown: boolean) {
  return shown ? 'ще немає' : kind === 'report' ? 'коли виберете запис' : 'після публікації';
}

export type GroupsProps = {
  template: PaperTemplateRef;
  values: FieldValues;
  /** Text of each zone on the sheet. */
  zones: Record<string, string>;
  /** Fields of conditional blocks: shown only while the block is on. */
  conditions: Conditions;
  mode: FieldsMode;
  /** Auto fields show the record: published (a report — its record chosen). */
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
export function FieldGroups({ template, values, zones, conditions, mode, published, active, onChange, onActive, onJump, onZoneText }: GroupsProps) {
  const shown = template.fields.filter((f) => !isOff(f.key, conditions, values));
  const auto = shown.filter((f) => f.auto);
  const rest = shown.filter((f) => !f.auto);
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
        {mode === 'fill' && conditions[f.key] && <p className="hint">{conditionNote(template, conditions[f.key]!)}</p>}
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
            <AutoRow key={f.key} field={f} value={values[f.key]} placeholder={autoPlaceholder(template.kind, published)} />
          ))}
        </section>
      )}
    </>
  );
}

/** An auto field: what the record holds, or when it comes. */
function AutoRow({ field: f, value, placeholder }: { field: PaperField; value: FieldValue | undefined; placeholder: string }) {
  const records = usePaperRecords();
  const text = value !== undefined ? valueText(f.type, value, f.options, (type, id) => records.get(type, id)?.title ?? null) : null;
  return (
    <div className={s.autoRow}>
      <span>{f.label}</span>
      <span className={text === null ? s.later : undefined}>{text ?? placeholder}</span>
    </div>
  );
}

/**
 * «Поля» (from 900 px): the template, how much is filled, what is still
 * missing; fields the actor fills, then those a moderator fills.
 */
export function FieldsPanel(props: Omit<GroupsProps, 'onZoneText'>) {
  const { template, values, zones, conditions } = props;
  const editable = props.mode === 'fill';
  const p = fillProgress(template, values, zones, conditions);
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

/** Why a field of a conditional block is shown: «Поле з'явилось, бо обрано «Штраф»». */
export function conditionNote(template: PaperTemplateRef, c: Condition): string {
  const choice = template.fields.find((f) => f.key === c.field)?.options?.find((o) => o.key === c.value)?.label ?? c.value;
  return `Поле з'явилось, бо обрано «${choice}»`;
}
