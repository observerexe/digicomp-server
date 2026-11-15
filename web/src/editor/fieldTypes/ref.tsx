import { useState } from 'react';
import type { RecordType } from '../../api/types';
import { RECORD_MISSING, refType } from '../../../../shared/editor-schema/fields';
import { recordHref, useCandidates, useSettled, type RecordView } from '../../lib/records';
import { usePaperRecords } from '../records';
import type { FieldType, WidgetProps } from '.';
import s from './widgets.module.css';

/** Focus a control after React has drawn it (the picker and the chosen record swap places). */
const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/**
 * Finds a record of one type: type a part of the title or code, choose with
 * arrows and Enter or a click. Records in `exclude` are not offered.
 */
function RecordSearch({ id, type, disabled, exclude, onPick }: { id: string; type: RecordType; disabled: boolean; exclude: readonly unknown[]; onPick: (r: RecordView) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const q = useSettled(text.trim());
  const found = useCandidates(type, q, open && !disabled);
  const items = (found.data ?? []).filter((c) => c.type === type && !exclude.includes(c.id));
  const listId = `${id}-list`;
  const pick = (r: RecordView) => {
    setText('');
    setOpen(false);
    onPick(r);
  };
  const note = found.isPending ? 'Шукаємо…' : found.isError ? 'Не вдалося знайти' : items.length === 0 ? 'Нічого не знайдено' : null;
  return (
    <span className={s.combo}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[at] ? `${listId}-${at}` : undefined}
        autoComplete="off"
        placeholder={disabled ? '' : 'Почніть вводити назву'}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setAt(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setAt((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAt((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = open ? items[at] : undefined;
            if (r) pick(r);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {open && (
        <span className={s.popup}>
          {note ? (
            <span className={s.note}>{note}</span>
          ) : (
            <ul id={listId} role="listbox" className={s.options} aria-label="Знайдено">
              {items.map((c, i) => (
                // The input keeps the focus: a choice is made on press, before it would blur.
                <li
                  key={c.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === at}
                  className={s.option}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                >
                  <span>{c.title}</span>
                  {c.code && <span className={s.sub}>{c.code}</span>}
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </span>
  );
}

/** The chosen record: its title (opens in a new tab), «×» to choose another. */
function Chosen({ id, label, record, disabled, onClear }: { id: string; label: string; record: RecordView | undefined; disabled: boolean; onClear: () => void }) {
  const href = record && recordHref(record.type, record.id, record.code);
  return (
    <span className={s.chosen}>
      {record && href ? (
        <a id={disabled ? id : undefined} href={href} target="_blank" rel="noopener noreferrer" className={s.chosenTitle}>
          {record.title}
        </a>
      ) : (
        <span className={`${s.chosenTitle} ${record ? '' : s.missing}`}>{record?.title ?? RECORD_MISSING}</span>
      )}
      {record?.archived && <span className={s.sub}>в архіві</span>}
      {!disabled && (
        <button id={id} type="button" className="btn btn-ghost" aria-label={`Вибрати інше: ${label}`} onClick={onClear}>
          ×
        </button>
      )}
    </span>
  );
}

/** A record of the app (member, task, equipment…): a picker with search. */
export const ref: FieldType = {
  Widget: ({ id, field, value, disabled, onChange, taken = [] }: WidgetProps) => {
    const records = usePaperRecords();
    const type = refType(field.type) as RecordType;
    if (typeof value === 'string') {
      return (
        <Chosen
          id={id}
          label={field.label}
          record={records.get(type, value)}
          disabled={disabled}
          onClear={() => {
            onChange(null);
            focusLater(id);
          }}
        />
      );
    }
    return (
      <RecordSearch
        id={id}
        type={type}
        disabled={disabled}
        exclude={taken}
        onPick={(r) => {
          records.add(r);
          onChange(r.id);
          focusLater(id);
        }}
      />
    );
  },
};
