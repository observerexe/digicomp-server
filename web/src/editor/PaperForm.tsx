import type { ReactNode } from 'react';
import { FieldGroups, fillProgress, type GroupsProps } from './FieldsPanel';
import s from './FieldsPanel.module.css';

/**
 * «Форма» on the phone (narrower than 900 px): the template's fields on the
 * whole screen, plain zones written right here; below — whether it is saved
 * and how many required fields are filled.
 */
export function PaperForm({ saved, ...props }: Required<GroupsProps> & { saved: ReactNode }) {
  const p = fillProgress(props.template, props.values, props.zones);
  return (
    <section className={s.form} aria-label="Форма документа">
      <div className={s.formBody}>
        <FieldGroups {...props} />
      </div>
      <footer className={s.formFoot}>
        {saved}
        {props.editable && p.required > 0 && (
          <span>
            {p.requiredFilled} з {p.required} обов&apos;язкових
          </span>
        )}
      </footer>
    </section>
  );
}
