import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
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
  const menu = useRef<HTMLUListElement>(null);
  const { choices } = props;
  // A menu takes the focus to its first item; the arrows move it, Escape returns it to the button (useDropdown).
  useEffect(() => {
    if (d.open) items(menu.current)[0]?.focus();
  }, [d.open]);
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
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={d.open} aria-controls={id} disabled={props.disabled} onClick={() => d.setOpen(!d.open)}>
        {props.label}
        <Icon name="down" size={18} />
      </button>
      {/* On a phone the menu is a sheet at the bottom of the screen over a dimmed page; a tap on it closes the menu. */}
      {d.open && <div className={s.backdrop} aria-hidden="true" onClick={() => d.setOpen(false)} />}
      {d.open && (
        <ul id={id} ref={menu} className={s.menu} role="menu" aria-label={props.label} onKeyDown={moveFocus}>
          {choices.map((c) => (
            <li key={c.id ?? ''} role="none">
              <button
                type="button"
                role="menuitem"
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

const items = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

/** ↑ / ↓ (round), Home / End over the items that can be chosen. */
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  const all = items(e.currentTarget);
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
  if (to === undefined || !all.length) return;
  e.preventDefault();
  all[(to + all.length) % all.length]!.focus();
}
