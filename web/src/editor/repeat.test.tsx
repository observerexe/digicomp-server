import type { JSONContent } from '@tiptap/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { testEditor } from '../test/editor';
import type { PaperField, PaperTemplateRef } from '../api/types';
import type { FieldValue, FieldValues } from '../../../shared/editor-schema/fields';
import { BLOCKS } from './blocks';
import { badFields, blockContent, blockTag, selectionOf } from './builder';
import { paperExtensions } from './extensions';
import { fieldPosition, fieldTargets, setFieldsLook } from './fields';
import { FieldGroups, fillProgress, isFilled } from './FieldsPanel';
import { PaperRecordsContext } from './records';
import { columnsOf, keysOf } from './template';
import { lookOf } from './useFill';

/** «Відомість»: № | Бали | За що — the last row repeats. */
const cell = (type: string, content: JSONContent[] = []): JSONContent => ({ type, content: [{ type: 'paragraph', content }] });
const table = (...rows: JSONContent[][]): JSONContent => ({ type: 'table', content: rows.map((content) => ({ type: 'tableRow', content })) });
const field = (key: string): JSONContent => ({ type: 'field', attrs: { key } });
const header = [cell('tableHeader', [{ type: 'text', text: '№' }]), cell('tableHeader', [{ type: 'text', text: 'Бали' }]), cell('tableHeader', [{ type: 'text', text: 'За що' }])];
const repeated = [cell('tableCell', [{ type: 'rowNumber' }]), cell('tableCell', [field('points')]), cell('tableCell', [field('reason')])];
const body = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const sheet = body({ type: 'paragraph', content: [field('title')] }, { type: 'repeat', attrs: { key: 'rows1' }, content: [table(header, repeated)] });

const pf = (over: Partial<PaperField> & Pick<PaperField, 'key' | 'label'>): PaperField => ({
  type: 'text',
  required: false,
  fill: 'author',
  editable: false,
  print: true,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  scale: null,
  options: null,
  dictionary: null,
  plain: false,
  binding: null,
  auto: false,
  canFill: true,
  columns: null,
  ...over,
});
const rowsField = pf({
  key: 'rows1',
  label: 'Нарахування',
  type: 'rows',
  required: true,
  maxItems: 2,
  columns: [pf({ key: 'points', label: 'Бали', type: 'int', required: true }), pf({ key: 'reason', label: 'За що' })],
});
const template: PaperTemplateRef = { id: 't', title: 'Відомість', kind: 'free', target: null, version: 1, fields: [pf({ key: 'title', label: 'Назва' }), rowsField] };

function openDocument(onFieldClick = vi.fn()) {
  return testEditor({
    extensions: paperExtensions({ template: { plain: new Set(), locked: new Set(), fillable: new Set(['title', 'rows1']), onFieldClick } }),
    content: sheet,
  });
}

describe('Повторювані рядки: документ', () => {
  it('аркуш малює рядки зі значень: шапка, номер, клітинки як поля', () => {
    const editor = openDocument();
    const show = (values: FieldValues) =>
      setFieldsLook(
        editor,
        lookOf(template, values, {}, null, () => null, false),
      );
    show({ rows1: [{ points: 5, reason: 'Монтаж' }, {}] });
    const block = editor.view.dom.querySelector('.paper-rows')!;
    const rows = [...block.querySelectorAll('tr')].map((r) => r.textContent);
    expect(rows).toEqual(['№БалиЗа що', '15Монтаж', '2БалиЗа що']);
    const cells = block.querySelectorAll<HTMLElement>('span.paper-field');
    expect([...cells].map((c) => c.className)).toEqual(['paper-field is-filled', 'paper-field is-filled', 'paper-field is-missing', 'paper-field is-empty']);
    // No rows yet: one row of the labels, no numbers.
    show({});
    expect([...block.querySelectorAll('tr')].map((r) => r.textContent)).toEqual(['№БалиЗа що', 'БалиЗа що']);
    expect(block.querySelector('tr.is-empty-row')).not.toBeNull();
  });

  it('клік по клітинці відкриває її в панелі; Tab — блок цілком; текст блоку не змінюється', () => {
    const onFieldClick = vi.fn();
    const editor = openDocument(onFieldClick);
    setFieldsLook(
      editor,
      lookOf(template, { rows1: [{ points: 5 }, { points: 7 }] }, {}, null, () => null, false),
    );
    const second = editor.view.dom.querySelectorAll<HTMLElement>('span.paper-field[data-row="1"]')[0]!;
    second.click();
    expect(onFieldClick).toHaveBeenLastCalledWith('rows1', { row: 1, column: 'points' });
    (editor.view.dom.querySelector('.paper-rows th') as HTMLElement).click();
    expect(onFieldClick).toHaveBeenLastCalledWith('rows1', undefined);
    expect(fieldTargets(editor.state.doc, new Set(['title', 'rows1'])).map((t) => t.key)).toEqual(['title', 'rows1']);
    expect(fieldPosition(editor, 'rows1')).not.toBeNull();
    const before = editor.getJSON();
    editor.commands.insertContentAt(fieldPosition(editor, 'rows1')! + 4, 'x');
    expect(editor.getJSON()).toEqual(before);
  });

  it('заповнено: рядок не порожній, у кожному — обов’язкові клітинки', () => {
    expect(isFilled(rowsField, {}, {})).toBe(false);
    expect(isFilled(rowsField, { rows1: [{}] }, {})).toBe(false);
    expect(isFilled(rowsField, { rows1: [{ reason: 'х' }] }, {})).toBe(false);
    expect(isFilled(rowsField, { rows1: [{ points: 1 }, {}] }, {})).toBe(true);
    expect(fillProgress(template, { rows1: [{ points: 1 }] }, {}).missing).toEqual([]);
  });

  it('панель: картка на рядок; «Додати рядок» до межі; «×» прибирає свій рядок', async () => {
    const changes: (FieldValue | null)[] = [];
    function Panel() {
      const [values, setValues] = useState<FieldValues>({ rows1: [{ points: 5 }] });
      return (
        <PaperRecordsContext value={{ get: () => undefined, add: vi.fn() }}>
          <FieldGroups
            template={template}
            values={values}
            zones={{}}
            conditions={{}}
            mode="fill"
            published={false}
            active={null}
            onChange={(key, v) => {
              changes.push(v);
              setValues((prev) => {
                const next = { ...prev };
                if (v === null) delete next[key];
                else next[key] = v;
                return next;
              });
            }}
            onActive={vi.fn()}
            onJump={vi.fn()}
          />
        </PaperRecordsContext>
      );
    }
    render(<Panel />);
    const group = screen.getByRole('group', { name: 'Нарахування' });
    expect(within(group).getByRole('group', { name: 'Рядок 1' })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: '+ Додати рядок' }));
    expect(changes.at(-1)).toEqual([{ points: 5 }, {}]);
    expect(within(group).getByRole('button', { name: '+ Додати рядок' })).toBeDisabled();
    // The new row's first cell gets the cursor.
    await waitFor(() => expect(document.activeElement).toBe(within(group).getAllByLabelText(/^Бали/)[1]));
    await userEvent.type(within(group).getAllByLabelText('За що')[1]!, 'Звіт');
    expect(changes.at(-1)).toEqual([{ points: 5 }, { reason: 'Звіт' }]);
    await userEvent.click(within(group).getByRole('button', { name: 'Прибрати рядок 1' }));
    expect(changes.at(-1)).toEqual([{ reason: 'Звіт' }]);
    await userEvent.click(within(group).getByRole('button', { name: 'Прибрати рядок 1' }));
    expect(changes.at(-1)).toBeNull();
    expect(within(group).getByText('Рядків ще немає.')).toBeInTheDocument();
  });
});

describe('Повторювані рядки: конструктор', () => {
  const rowsBlock = BLOCKS.find((b) => b.key === 'rows')!;
  const openBuilder = (content: JSONContent) => testEditor({ content });

  it('блок вставляє таблицю: шапка «№ | Стовпець», нижній рядок з «№ рядка»', () => {
    const { content, inline } = blockContent(rowsBlock, 'rows1');
    expect(inline).toBe(false);
    const editor = openBuilder(body(content));
    expect(editor.getJSON().content?.[0]?.type).toBe('repeat');
    expect(badFields(editor.state.doc)).toBe(false);
    expect(keysOf(editor.state.doc)).toEqual(['rows1']);
  });

  it('ключі: блок — перед стовпцями; стовпці — поля нижнього рядка', () => {
    const editor = openBuilder(sheet);
    expect(keysOf(editor.state.doc)).toEqual(['title', 'rows1', 'points', 'reason']);
    expect([...columnsOf(editor.state.doc)]).toEqual([
      ['points', 'rows1'],
      ['reason', 'rows1'],
    ]);
  });

  it('не можна: поле чи «№ рядка» в шапці, зону в блоці, стовпець ще й поза блоком, «№ рядка» поза блоком', () => {
    const bad = (content: JSONContent) => badFields(openBuilder(content).state.doc);
    expect(bad(sheet)).toBe(false);
    const headed = (cells: JSONContent[]) => body({ type: 'repeat', attrs: { key: 'rows1' }, content: [table(cells, repeated)] });
    expect(bad(headed([cell('tableHeader', [field('title')])]))).toBe(true);
    expect(bad(headed([cell('tableHeader', [{ type: 'rowNumber' }])]))).toBe(true);
    const zoned = body({
      type: 'repeat',
      attrs: { key: 'rows1' },
      content: [table(header, [{ type: 'tableCell', content: [{ type: 'fieldZone', attrs: { key: 'z' }, content: [{ type: 'paragraph' }] }] }])],
    });
    expect(bad(zoned)).toBe(true);
    expect(bad(body(...(sheet.content ?? []), { type: 'paragraph', content: [field('points')] }))).toBe(true);
    expect(bad(body({ type: 'paragraph', content: [{ type: 'rowNumber' }] }))).toBe(true);
  });

  it('мітка блоку — поле рядків і стовпці; курсор у блоці — властивості поля рядків; нижній рядок позначено', () => {
    const editor = openBuilder(sheet);
    const node = editor.state.doc.child(1);
    expect(blockTag(node, { editable: true, fields: { rows1: { text: '', state: 'field', tag: 'Повторювані рядки · rows1', group: 'structure' } } })).toEqual({
      label: 'Повторювані рядки · rows1 · 2 стовпці',
      group: 'structure',
    });
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 5);
    expect(selectionOf(editor.state)).toEqual({ kind: 'field', key: 'rows1', picked: false });
  });
});
