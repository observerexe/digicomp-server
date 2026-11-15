import { Editor, type JSONContent } from '@tiptap/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PaperField, PaperTemplateRef } from '../api/types';
import { conditionsIn, isOff } from './conditional';
import { paperExtensions } from './extensions';
import { fieldPosition, fieldTargets, setFieldsLook } from './fields';
import { FieldGroups, fillProgress } from './FieldsPanel';
import { PaperRecordsContext } from './records';

/** «Подання»: the kind of discipline, the fine's size only for a fine, the reason. */
const body: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'field', attrs: { key: 'type' } }] },
    {
      type: 'conditional',
      attrs: { field: 'type', value: 'fine' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Розмір: ' },
            { type: 'field', attrs: { key: 'amount' } },
          ],
        },
      ],
    },
    { type: 'fieldZone', attrs: { key: 'reason' }, content: [{ type: 'paragraph' }] },
  ],
};

function open() {
  return new Editor({
    extensions: paperExtensions({ template: { plain: new Set(), locked: new Set(), fillable: new Set(['type', 'amount', 'reason']), onFieldClick: vi.fn() } }),
    injectCSS: false,
    content: body,
  });
}

const field = (over: Partial<PaperField>): PaperField => ({
  key: 'f',
  label: 'Поле',
  type: 'text',
  required: true,
  fill: 'author',
  editable: false,
  print: true,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  scale: null,
  options: null,
  plain: false,
  binding: null,
  auto: false,
  canFill: true,
  ...over,
});
const template: PaperTemplateRef = {
  id: 't',
  title: 'Подання про стягнення',
  kind: 'creates',
  target: 'discipline_record',
  version: 1,
  fields: [
    field({
      key: 'type',
      label: 'Вид стягнення',
      type: 'enum',
      options: [
        { key: 'warning', label: 'Попередження' },
        { key: 'fine', label: 'Штраф' },
      ],
    }),
    field({ key: 'amount', label: 'Розмір штрафу, балів', type: 'int' }),
    field({ key: 'reason', label: 'Підстава', type: 'richtext' }),
  ],
};

describe('Умовний блок', () => {
  it('поля блоку чекають на свою умову', () => {
    const editor = open();
    const conditions = conditionsIn(editor.state.doc);
    expect(conditions).toEqual({ amount: { field: 'type', value: 'fine' } });
    expect(isOff('amount', conditions, {})).toBe(true);
    expect(isOff('amount', conditions, { type: 'fine' })).toBe(false);
    expect(isOff('reason', conditions, {})).toBe(false);
  });

  it('на аркуші: поки умова не виконується, блок прихований, Tab його оминає', () => {
    const editor = open();
    const block = () => editor.view.dom.querySelector('.paper-if')!;
    const look = (values: Record<string, string>) => setFieldsLook(editor, { fields: {}, zones: {}, active: null, values });
    look({});
    expect(block().classList.contains('is-off')).toBe(true);
    expect(fieldTargets(editor.state.doc, new Set(['type', 'amount', 'reason']), {}).map((t) => t.key)).toEqual(['type', 'reason']);
    look({ type: 'fine' });
    expect(block().classList.contains('is-off')).toBe(false);
    expect(fieldTargets(editor.state.doc, new Set(['type', 'amount', 'reason']), { type: 'fine' }).map((t) => t.key)).toEqual(['type', 'amount', 'reason']);
    expect(fieldPosition(editor, 'amount')).not.toBeNull();
  });

  it('панель: поле блоку з’являється з поясненням; обов’язкові рахуються лише увімкнені', () => {
    const conditions = { amount: { field: 'type', value: 'fine' } };
    const props = { template, zones: {}, conditions, mode: 'fill' as const, published: false, active: null, onChange: vi.fn(), onActive: vi.fn(), onJump: vi.fn() };
    const records = { get: () => undefined, add: vi.fn() };
    const { rerender } = render(
      <PaperRecordsContext value={records}>
        <FieldGroups {...props} values={{ type: 'warning' }} />
      </PaperRecordsContext>,
    );
    expect(screen.queryByText('Розмір штрафу, балів')).not.toBeInTheDocument();
    expect(fillProgress(template, { type: 'warning' }, {}, conditions).required).toBe(2);
    rerender(
      <PaperRecordsContext value={records}>
        <FieldGroups {...props} values={{ type: 'fine' }} />
      </PaperRecordsContext>,
    );
    expect(screen.getByText('Розмір штрафу, балів')).toBeInTheDocument();
    expect(screen.getByText("Поле з'явилось, бо обрано «Штраф»")).toBeInTheDocument();
    expect(fillProgress(template, { type: 'fine' }, {}, conditions).required).toBe(3);
  });
});
