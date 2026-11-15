import { useId } from 'react';
import { useDropdown } from '../lib/useDropdown';
import { Icon } from './Icon';
import s from './ChoiceButton.module.css';

export type Choice = {
  /** What onPick gets; null — e.g. «Порожній документ». */
  id: string | null;
  title: string;
  /** Can not be chosen now, with why. */
  disabledNote?: string;
};

/**
 * A primary button for a choice that is usually not needed: one choice —
 * acts at once; several — a short menu under the button.
 */
export function ChoiceButton(props: {
  label: string;
  choices: Choice[];
  disabled?: boolean;
  /** Why the button does nothing when there is nothing to choose. */
  emptyNote?: string;
  /** Default — the primary button. */
  className?: string;
  onPick: (id: string | null) => void;
}) {
  const d = useDropdown();
  const id = useId();
  const { choices } = props;
  const className = props.className ?? 'btn btn-primary';
  if (choices.length <= 1) {
    const only = choices[0];
    return (
      <button
        type="button"
        className={className}
        disabled={props.disabled || !only || !!only.disabledNote}
        title={only ? only.disabledNote : props.emptyNote}
        onClick={() => only && props.onPick(only.id)}
      >
        {props.label}
      </button>
    );
  }
  return (
    <div className={s.root} ref={d.root} onKeyDown={d.onKeyDown}>
      <button type="button" className={className} aria-haspopup="true" aria-expanded={d.open} aria-controls={id} disabled={props.disabled} onClick={() => d.setOpen(!d.open)}>
        {props.label}
        <Icon name="down" size={18} />
      </button>
      {d.open && (
        <ul id={id} className={s.menu} aria-label={props.label}>
          {choices.map((c) => (
            <li key={c.id ?? ''}>
              <button
                type="button"
                disabled={!!c.disabledNote}
                onClick={() => {
                  d.setOpen(false);
                  props.onPick(c.id);
                }}
              >
                {c.title}
                {c.disabledNote && <span className={s.note}>{c.disabledNote}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
