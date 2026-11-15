import type { Editor } from '@tiptap/core';
import { useEffect } from 'react';
import { SIGNER_AUTHOR, SIGNER_ORG } from '../../../shared/editor-schema';
import { dayText, signName, yearText, type FieldValues, type RecordTitle } from '../../../shared/editor-schema/fields';
import { useOrgSettings } from '../lib/org';
import { setSheetInfo } from './structure';

/** Names of the members `ref:user` fields hold (signatures), by the field's key; null — none picked. */
export type People = Record<string, string | null>;

/** Who `ref:user` fields of a document hold, by name («Ім'я ПРІЗВИЩЕ»). */
export function peopleOf(fields: readonly { key: string; type: string }[], values: FieldValues, title: RecordTitle): People {
  const out: People = {};
  for (const f of fields) {
    if (f.type !== 'ref:user') continue;
    const v = values[f.key];
    const name = typeof v === 'string' ? title('user', v) : null;
    out[f.key] = name === null ? null : signName(name);
  }
  return out;
}

type SheetOptions = {
  /** The template constructor: auto values by their names, a field's signature — `{Підпис поля}`. */
  builder?: boolean;
  /** The document's author (name as in the profile); in the constructor — none. */
  author?: string | null;
  publishedAt?: string | null;
  number?: string | null;
  people?: People;
};

/**
 * What the header, «Затверджую», signatures and auto values show on the
 * sheet: «Реквізити», the author, the day of publication, members of fields.
 */
export function useSheet(editor: Editor, { builder = false, author = null, publishedAt = null, number = null, people = {} }: SheetOptions) {
  const org = useOrgSettings().data;
  // The names are compared by value: a new object each render is the same sheet.
  const peopleKey = JSON.stringify(people);
  useEffect(() => {
    const names = JSON.parse(peopleKey) as People;
    setSheetInfo(editor, {
      builder,
      number,
      paper: {
        institution: org?.institution ?? '',
        groupName: org?.groupName ?? '',
        signerPosition: org?.signerPosition ?? '',
        person: (signer) => {
          if (signer === SIGNER_AUTHOR) return builder ? '{Автор}' : author ? signName(author) : null;
          if (signer === SIGNER_ORG) return org?.signer ? signName(org.signer.name) : null;
          return names[signer] ?? null;
        },
        date: publishedAt ? dayText(publishedAt) : null,
        year: yearText(publishedAt ?? new Date()),
      },
    });
  }, [editor, org, builder, author, publishedAt, number, peopleKey]);
}
