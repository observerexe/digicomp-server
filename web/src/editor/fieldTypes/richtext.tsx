import type { FieldType } from '.';

/** A free zone: written on the sheet itself; here — the way there. */
export const richtext: FieldType = {
  Widget: ({ id, field, disabled, onJump }) => (
    <button id={id} type="button" className="btn" onClick={onJump}>
      {disabled ? 'Показати на аркуші' : field.plain ? 'Писати на аркуші (лише текст)' : 'Писати на аркуші'}
    </button>
  ),
};
