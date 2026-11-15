import type { FieldType } from '.';

/** A record of the app (member, equipment…): the picker comes in a later version. */
export const ref: FieldType = {
  Widget: ({ id }) => <input id={id} type="text" disabled placeholder="Вибір з’явиться згодом" />,
};
