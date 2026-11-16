import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PaperTemplateRef } from '../api/types';
import type { RecordView } from '../lib/records';
import { ROWS, rowsIn, valueText, type Condition, type FieldValue, type FieldValues, type RecordTitle } from '../../../shared/editor-schema/fields';
import { conditionsIn } from './conditional';
import { paperExtensions } from './extensions';
import type { RibbonLock } from './Ribbon';
import { fieldPosition, setFieldsLook, zoneAtSelection, zoneTexts, type FieldLook, type FieldsLook } from './fields';
import { cellControlId, fieldControlId, isFilled, reportRecordKey } from './FieldsPanel';
import type { MentionMenuState, MentionSuggest } from './mention';
import { recordKey, type PaperRecords } from './records';
import type { RowCell } from './repeat';

/**
 * Filling a document: values of fields, texts of zones, the field in focus,
 * records of `ref:*` values and «@», the «@» list — and what the sheet shows
 * of them. The document page saves what changes; «Документ» in the template
 * constructor only tries the template (nothing is saved).
 */

/**
 * What the sheet shows for each field and zone now. An auto field: what the
 * record holds (plain text), or grey — when it comes.
 */
export function lookOf(template: PaperTemplateRef, values: FieldValues, zones: Record<string, string>, active: string | null, title: RecordTitle, published: boolean): FieldsLook {
  const look: FieldsLook = { fields: {}, zones: {}, rows: {}, active, values };
  for (const f of template.fields) {
    const filled = isFilled(f, values, zones);
    if (f.type === ROWS) {
      // A cell reads as a field: its value, or the column's label.
      const columns = f.columns ?? [];
      const blank = (required: boolean, label: string): FieldLook => ({
        text: label,
        state: f.fill === 'staff' && !f.canFill ? 'staff' : required ? 'missing' : 'empty',
      });
      const cell = (c: (typeof columns)[number], v: FieldValue | undefined): FieldLook =>
        v !== undefined ? { text: valueText(c.type, v, c.options, title), state: 'filled' } : blank(c.required, c.label);
      look.rows[f.key] = {
        rows: rowsIn(values[f.key]).map((r) => Object.fromEntries(columns.map((c) => [c.key, cell(c, r[c.key])]))),
        empty: Object.fromEntries(columns.map((c) => [c.key, blank(f.required, c.label)])),
        active: false,
      };
      continue;
    }
    if (f.auto && f.type !== 'richtext') {
      const v = values[f.key];
      look.fields[f.key] =
        v !== undefined
          ? { text: valueText(f.type, v, f.options, title), state: 'fixed' }
          : { text: published ? 'ще немає' : template.kind === 'report' ? 'з’явиться, коли виберете запис' : 'заповниться після публікації', state: 'auto' };
      continue;
    }
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
  /** The actor fills a draft or changes a published document now. */
  editable: boolean;
  /** Published (or later): auto fields show the record (a report's — once it is chosen). */
  published?: boolean;
  /**
   * The fields' controls are not on the screen now (the phone shows the page):
   * show them; true — they appear after React draws again.
   */
  showControls?: () => boolean;
};

/** Before the editor: its extensions and the state of filling. */
export function useFill({ template, values: initial, refs, editable, published = false, showControls }: FillOptions) {
  const [values, setValues] = useState<FieldValues>(initial);
  const [zones, setZones] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState<Record<string, Condition>>({});
  const [active, setActive] = useState<string | null>(null);
  // A click on a field on the sheet opens its control in the panel (on the phone — in the form).
  const show = useRef(showControls);
  useEffect(() => {
    show.current = showControls;
  });
  const openField = useRef((key: string, cell?: RowCell) => {
    setActive(key);
    const id = cell ? cellControlId(key, cell.row, cell.column) : fieldControlId(key);
    const focus = () => document.getElementById(id)?.focus();
    if (show.current?.()) requestAnimationFrame(focus);
    else focus();
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
            onFieldClick: (key, cell) => openField.current(key, cell),
          }
        : undefined,
      mention: {
        record: (type, id) => recordMap.current.get(recordKey(type, id)) ?? null,
        suggest: editable ? suggest : null,
      },
    });
    // Built once: the editor keeps its extensions; `records` reads the same map.
  }, [template, editable]);

  /** Texts of zones and fields of conditional blocks from the editor's document (on create and on each change). */
  const syncZones = (doc: PMNode) => {
    const texts = zoneTexts(doc);
    setZones((prev) => (JSON.stringify(prev) === JSON.stringify(texts) ? prev : texts));
    const conds = conditionsIn(doc);
    setConditions((prev) => (JSON.stringify(prev) === JSON.stringify(conds) ? prev : conds));
  };
  /** A field's new value (null — emptied); returns every value. */
  const change = (key: string, v: FieldValue | null): FieldValues => {
    const next = { ...values };
    if (v === null) delete next[key];
    else next[key] = v;
    setValues(next);
    return next;
  };

  /**
   * A report's draft: what its record shows now in the fields nobody fills
   * (the server's answer to a save), with the records they refer to.
   */
  const takeAuto = (next: FieldValues, found: readonly RecordView[]) => {
    for (const r of found) records.add(r);
    setValues((prev) => {
      const out = { ...prev };
      for (const f of template?.fields ?? []) {
        if (!f.auto) continue;
        if (next[f.key] === undefined) delete out[f.key];
        else out[f.key] = next[f.key]!;
      }
      return JSON.stringify(out) === JSON.stringify(prev) ? prev : out;
    });
  };

  // A report shows its record as soon as it is chosen.
  const reportKey = reportRecordKey(template);
  const shown = published || (reportKey !== null && values[reportKey] !== undefined);

  return {
    template,
    editable,
    /** Auto fields show the record: published, or a report's record chosen. */
    published: shown,
    values,
    change,
    takeAuto,
    zones,
    conditions,
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
  const { template, values, zones, active, recordTitle, recordsVersion, editable, published } = fill;
  const zone = useEditorState({ editor, selector: ({ editor: e }) => (template ? zoneAtSelection(e.state) : null) });
  const shownActive = zone ?? refused ?? active;
  useEffect(() => {
    if (template) setFieldsLook(editor, lookOf(template, values, zones, shownActive, recordTitle, published));
    // recordsVersion: a picked record's title is shown on the sheet.
  }, [editor, template, values, zones, shownActive, recordsVersion, published]);

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
  /** Why the ribbon is off where the cursor is (text of the template, a plain zone); null — it works. */
  const ribbonLock: RibbonLock | null = !template || !editable ? null : zone === null ? 'template' : template.fields.find((f) => f.key === zone)?.plain ? 'plain' : null;
  /** A field picked in the panel: active, in view. */
  const onActive = (key: string | null) => {
    fill.setActive(key);
    if (key) showField(key, false);
  };
  return { shownActive, showField, ribbonLock, onActive };
}
