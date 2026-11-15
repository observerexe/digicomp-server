import type { ReactNode } from 'react';
import type { PaperField } from '../../api/types';
import type { FieldValue } from '../../../../shared/editor-schema/fields';
import { bool } from './bool';
import { color } from './color';
import { date } from './date';
import { datetime } from './datetime';
import { decimal } from './decimal';
import { enumType } from './enum';
import { int } from './int';
import { list } from './list';
import { ref } from './ref';
import { richtext } from './richtext';
import { text } from './text';

/**
 * Field types of the editor: type → how the panel fills it. How a value reads
 * on the sheet and in the print is one for all — valueText (shared/editor-schema/fields.ts).
 * A new type is one new file here and a line in TYPES.
 */

export type WidgetProps = {
  /** id of the control: the label points at it, a click on the sheet focuses it. */
  id: string;
  field: PaperField;
  value: FieldValue | undefined;
  disabled: boolean;
  /** null — empty the field. */
  onChange: (value: FieldValue | null) => void;
  /** Zones: bring the zone on the sheet into view and put the cursor there. */
  onJump: () => void;
  /** An item of a list: values the other items hold (not offered again). */
  taken?: readonly unknown[];
};

export type FieldType = {
  Widget: (props: WidgetProps) => ReactNode;
  /** The widget is a group (several controls): the label names it, not one control. */
  group?: boolean;
};

const TYPES: Record<string, FieldType> = { text, int, decimal, date, datetime, bool, enum: enumType, color, richtext };

export function fieldType(type: string): FieldType {
  return type.startsWith('list<') ? list : itemFieldType(type);
}

/** The widget of one value (`list<int>` → int, `ref:user` → the picker). */
export function itemFieldType(type: string): FieldType {
  return type.startsWith('ref:') ? ref : (TYPES[type] ?? text);
}
