import type { FieldType } from '.';
import s from './widgets.module.css';

/**
 * A free zone: written on the sheet itself; here — the way there. In the
 * phone's form a plain zone is written right here, a line a paragraph; a zone
 * with formatting shows its beginning (formatting and «@» live on the page).
 */
export const richtext: FieldType = {
  Widget: ({ id, field, disabled, onJump, zone }) => {
    if (zone && field.plain) {
      return <textarea id={id} rows={4} value={zone.text} maxLength={field.maxLength ?? undefined} disabled={disabled} onChange={(e) => zone.write(e.target.value)} />;
    }
    const button = (
      <button id={id} type="button" className="btn" onClick={onJump}>
        {zone ? (disabled ? 'Показати на сторінці' : 'Писати на сторінці') : disabled ? 'Показати на аркуші' : field.plain ? 'Писати на аркуші (лише текст)' : 'Писати на аркуші'}
      </button>
    );
    if (!zone) return button;
    return (
      <div className={s.zone}>
        {zone.text.trim() ? <p className={s.zoneText}>{zone.text.trim()}</p> : <p className={s.zoneEmpty}>Ще порожньо</p>}
        {button}
      </div>
    );
  },
};
