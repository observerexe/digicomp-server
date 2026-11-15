import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PaperTemplateRef } from '../api/types';
import type { RecordView } from '../lib/records';
import { valueText, type FieldValue, type FieldValues, type RecordTitle } from '../../../shared/editor-schema/fields';
import { paperExtensions } from './extensions';
import { fieldPosition, setFieldsLook, zoneAtSelection, zoneTexts, type FieldsLook } from './fields';
import { fieldControlId, isFilled } from './FieldsPanel';
import type { MentionMenuState, MentionSuggest } from './mention';
import { recordKey, type PaperRecords } from './records';

/**
 * Filling a document: values of fields, texts of zones, the field in focus,
 * records of `ref:*` values and «@», the «@» list — and what the sheet shows
 * of them. The document page saves what changes; «Документ» in the template
 * constructor only tries the template (nothing is saved).
 */

/** What the sheet shows for each field and zone now. */
export function lookOf(template: PaperTemplateRef, values: FieldValues, zones: Record<string, string>, active: string | null, title: RecordTitle): FieldsLook {
  const look: FieldsLook = { fields: {}, zones: {}, active };
  for (const f of template.fields) {
    const filled = isFilled(f, values, zones);
    if (f.type === 'richtext') {
      look.zones[f.key] = { label: f.label, missing: f.required && !filled };
      continue;
    }
    const v = values[f.key];
    look.fields[f.key] = {
      text: v !== undefined ? valueText(f.type, v, f.options, title) : f.label,
      state: filled ? 'filled' : f.fill === 'staff' && !f.canFill ? 'staff' : f.required ? 'missing' : 'empty',
    };
  }
  return look;
}

type FillOptions = {
  /** null — a free document (no fields; «@» anywhere). */
  template: PaperTemplateRef | null;
  values: FieldValues;
  /** Records the values and the text refer to, as the server gave them. */
  refs: readonly RecordView[];
  editable: boolean;
};

/** Before the editor: its extensions and the state of filling. */
export function useFill({ template, values: initial, refs, editable }: FillOptions) {
  const [values, setValues] = useState<FieldValues>(initial);
  const [zones, setZones] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  // A click on a field on the sheet opens its control in the panel.
  const openField = useRef((key: string) => {
    setActive(key);
    document.getElementById(fieldControlId(key))?.focus();
  });

  // Records of `ref:*` values and «@»: the server's, plus what is picked here.
  // A map in a ref: the sheet reads it at once, before React draws again.
  const recordMap = useRef(new Map(refs.map((r) => [recordKey(r.type, r.id), r])));
  const [recordsVersion, recordAdded] = useReducer((n: number) => n + 1, 0);
  const records = useMemo<PaperRecords>(
    () => ({
      get: (type, id) => recordMap.current.get(recordKey(type, id)),
      add: (r) => {
        if (recordMap.current.has(recordKey(r.type, r.id))) return;
        recordMap.current.set(recordKey(r.type, r.id), r);
        recordAdded();
      },
    }),
    // A new object when a record is added: the panel shows it.
    [recordsVersion],
  );
  const recordTitle: RecordTitle = (type, id) => records.get(type, id)?.title ?? null;

  // The list after «@»: shown by the page, keys from the editor while it is open.
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const menuKeys = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const extensions = useMemo(() => {
    const plain = new Set(template?.fields.filter((f) => f.plain).map((f) => f.key));
    const locked = new Set(template?.fields.filter((f) => f.type === 'richtext' && !f.canFill).map((f) => f.key));
    const suggest: MentionSuggest = {
      // A free document — anywhere; from a template — in a zone the actor fills, not plain text.
      allow: (state) => {
        if (!template) return true;
        const z = zoneAtSelection(state);
        return z !== null && !plain.has(z) && !locked.has(z);
      },
      show: (m) =>
        setMenu(
          m && {
            ...m,
            pick: (r) => {
              records.add(r);
              m.pick(r);
            },
          },
        ),
      key: (e) => menuKeys.current(e),
    };
    return paperExtensions({
      template: template
        ? {
            plain,
            locked,
            fillable: new Set(template.fields.filter((f) => f.canFill).map((f) => f.key)),
            onFieldClick: (key) => openField.current(key),
          }
        : undefined,
      mention: {
        record: (type, id) => recordMap.current.get(recordKey(type, id)) ?? null,
        suggest: editable ? suggest : null,
      },
    });
    // Built once: the editor keeps its extensions; `records` reads the same map.
  }, [template, editable]);

  /** Texts of zones from the editor's document (on create and on each change). */
  const syncZones = (doc: PMNode) => {
    const texts = zoneTexts(doc);
    setZones((prev) => (JSON.stringify(prev) === JSON.stringify(texts) ? prev : texts));
  };
  /** A field's new value (null — emptied); returns every value. */
  const change = (key: string, v: FieldValue | null): FieldValues => {
    const next = { ...values };
    if (v === null) delete next[key];
    else next[key] = v;
    setValues(next);
    return next;
  };

  return {
    template,
    editable,
    values,
    change,
    zones,
    syncZones,
    active,
    setActive,
    records,
    recordTitle,
    recordsVersion,
    extensions,
    menu,
    menuKeys,
    closeMenu: () => setMenu(null),
  };
}

export type Fill = ReturnType<typeof useFill>;

/**
 * After the editor: the sheet shows the state of filling; `refused` — a
 * field the server refused (shown as the active one).
 */
export function useFillSheet(editor: Editor, fill: Fill, refused: string | null = null) {
  const { template, values, zones, active, recordTitle, recordsVersion, editable } = fill;
  const zone = useEditorState({ editor, selector: ({ editor: e }) => (template ? zoneAtSelection(e.state) : null) });
  const shownActive = zone ?? refused ?? active;
  useEffect(() => {
    if (template) setFieldsLook(editor, lookOf(template, values, zones, shownActive, recordTitle));
    // recordsVersion: a picked record's title is shown on the sheet.
  }, [editor, template, values, zones, shownActive, recordsVersion]);

  /** Bring a field into view on the sheet; a zone — put the cursor in it. */
  const showField = (key: string, focusZone: boolean) => {
    const pos = fieldPosition(editor, key);
    if (pos === null) return;
    const zoneNode = editor.state.doc.nodeAt(pos)?.type.name === 'fieldZone';
    if (zoneNode && focusZone)
      editor
        .chain()
        .focus()
        .setTextSelection(pos + 2)
        .scrollIntoView()
        .run();
    else (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  };
  /** Why the ribbon is off where the cursor is; null — it works. */
  const ribbonLock =
    !template || !editable
      ? null
      : zone === null
        ? 'Тут текст шаблону: змінюються лише поля в панелі «Поля» і вільні зони в рамках.'
        : template.fields.find((f) => f.key === zone)?.plain
          ? 'Ця зона — лише текст, без форматування.'
          : null;
  /** A field picked in the panel: active, in view. */
  const onActive = (key: string | null) => {
    fill.setActive(key);
    if (key) showField(key, false);
  };
  return { shownActive, showField, ribbonLock, onActive };
}
