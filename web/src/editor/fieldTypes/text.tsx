import { FIELD_LIMITS } from '../../../../shared/editor-schema/fields';
import type { FieldType } from '.';

/** One line of text. */
export const text: FieldType = {
  Widget: ({ id, field, value, disabled, onChange }) => (
    <input
      id={id}
      type="text"
      value={typeof value === 'string' ? value : ''}
      maxLength={field.maxLength ?? FIELD_LIMITS.textDefault}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' ') || null)}
    />
  ),
};
