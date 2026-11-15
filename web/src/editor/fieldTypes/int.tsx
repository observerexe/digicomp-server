import type { FieldType } from '.';
import { NumberInput } from './NumberInput';

/** A whole number within the field's limits. */
export const int: FieldType = { Widget: (props) => <NumberInput {...props} integer /> };
