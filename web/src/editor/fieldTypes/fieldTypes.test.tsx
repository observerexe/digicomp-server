import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PaperField } from '../../api/types';
import type { FieldValue } from '../../../../shared/editor-schema/fields';
import { fieldType } from '.';

const f = (type: string, over: Partial<PaperField> = {}): PaperField => ({
  key: 'x',
  label: 'Поле',
  type,
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
  plain: false,
  canFill: true,
  ...over,
});

/** The widget with its value kept (as the page does) and a label pointing at its control. */
function widget(field: PaperField, initial?: FieldValue) {
  const onChange = vi.fn();
  const onJump = vi.fn();
  const { Widget, group } = fieldType(field.type);
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        {!group && field.type !== 'richtext' && <label htmlFor="w">Поле</label>}
        <Widget
          id="w"
          field={field}
          value={value}
          disabled={false}
          onChange={(v) => {
            onChange(v);
            setValue(v ?? undefined);
          }}
          onJump={onJump}
        />
      </>
    );
  }
  render(<Harness />);
  return { onChange, onJump };
}

describe('Реєстр типів полів', () => {
  it('text: рядок без переносів; порожній — null', async () => {
    const { onChange } = widget(f('text', { maxLength: 5 }));
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('maxLength', '5');
    await userEvent.type(input, 'аб');
    expect(onChange).toHaveBeenLastCalledWith('аб');
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('decimal: кома як крапка; зайві знаки не надсилаються', async () => {
    const { onChange } = widget(f('decimal'));
    await userEvent.type(screen.getByRole('textbox'), '2,5');
    expect(onChange).toHaveBeenLastCalledWith(2.5);
    await userEvent.type(screen.getByRole('textbox'), '55');
    expect(onChange).toHaveBeenLastCalledWith(2.55);
    await userEvent.type(screen.getByRole('textbox'), '5');
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Число, до 2 знаків після коми')).toBeInTheDocument();
  });

  it('datetime: день і час у Києві → момент, коли є обидва', async () => {
    const { onChange } = widget(f('datetime'));
    await userEvent.type(screen.getByLabelText('Поле'), '2026-12-01');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Поле: час'), '14:30');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-01T12:30:00.000Z');
  });

  it('bool: «—», «Так», «Ні»', async () => {
    const { onChange } = widget(f('bool'), false);
    expect(screen.getByRole('combobox')).toHaveValue('no');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'yes');
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.selectOptions(screen.getByRole('combobox'), '');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('enum: архівний пункт — лише там, де вже обраний', () => {
    widget(
      f('enum', {
        options: [
          { key: 'a', label: 'А' },
          { key: 'b', label: 'Б', archived: true },
        ],
      }),
      'b',
    );
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'А', 'Б (в архіві)']);
  });

  it('list<enum>: прапорці, не більше maxItems', async () => {
    const { onChange } = widget(
      f('list<enum>', {
        maxItems: 1,
        options: [
          { key: 'a', label: 'А' },
          { key: 'b', label: 'Б' },
        ],
      }),
      ['a'],
    );
    expect(screen.getByRole('checkbox', { name: 'Б' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'А' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('list<text>: рядок на значення, «Додати» й «Прибрати»', async () => {
    const { onChange } = widget(f('list<text>'), ['раз']);
    await userEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await userEvent.type(screen.getAllByRole('textbox')[1]!, 'два');
    expect(onChange).toHaveBeenLastCalledWith(['раз', 'два']);
    await userEvent.click(screen.getByRole('button', { name: 'Прибрати 1-й' }));
    expect(onChange).toHaveBeenLastCalledWith(['два']);
    expect(screen.getByRole('textbox')).toHaveValue('два');
  });

  it('ref: пікера ще немає', () => {
    widget(f('ref:user'));
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('richtext: перехід до зони на аркуші', async () => {
    const { onJump } = widget(f('richtext', { plain: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Писати на аркуші (лише текст)' }));
    expect(onJump).toHaveBeenCalled();
  });
});
