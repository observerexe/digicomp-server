import type { FieldType } from '.';
import { NumberInput } from './NumberInput';

/** A number with a fraction (quantities): comma or point. */
export const decimal: FieldType = { Widget: (props) => <NumberInput {...props} integer={false} /> };
