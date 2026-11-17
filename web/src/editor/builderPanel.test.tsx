import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RecordSchema } from '../api/types';
import { BLOCK_GROUPS, BLOCKS } from './blocks';
import { BuilderPanel } from './BuilderPanel';
import { newField, type FieldDef } from './template';
import { fieldBlockOf, type FieldBlock } from './blocks';

const ENTRY: RecordSchema = {
  type: 'points_entry',
  label: 'Нарахування балів',
  extensible: false,
  version: 'v1',
  fields: [
    { key: 'userId', label: 'Учасник', type: 'ref:user', required: true, create: true },
    { key: 'amount', label: 'Бали', type: 'int', required: true, create: true, min: 1, max: 1000 },
    { key: 'reason', label: 'За що', type: 'text', required: true, create: true, maxLength: 500 },
    { key: 'createdById', label: 'Нарахував', type: 'ref:user', nullable: true },
  ],
};

const field = (type: string, over: Partial<FieldDef>): FieldDef => ({ ...newField(fieldBlockOf(type) as FieldBlock, new Set()), ...over });
const rows = field('rows', { key: 'rows1', label: 'Нарахування' });
const member = field('ref:user', { key: 'member', label: 'Учасник' });
const note = field('text', { key: 'note', label: 'Примітка' });

function panel(selected: string, fields: FieldDef[], onChange = vi.fn(), kind: 'creates' | 'report' = 'creates', schema: RecordSchema = ENTRY) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BuilderPanel
        tab="props"
        tabs={['blocks', 'props', 'template']}
        onTab={() => {}}
        palette={{ groups: BLOCK_GROUPS, blocks: BLOCKS }}
        unavailable={() => null}
        settings={null}
        selected={{ kind: 'field', key: selected, picked: true }}
        defs={new Map(fields.map((f) => [f.key, f]))}
        fields={fields}
        columns={new Map([['member', 'rows1']])}
        kind={kind}
        schema={schema}
        onPick={() => {}}
        onChange={onChange}
        onRename={() => {}}
        onRemoveField={() => {}}
        onRemoveBlock={() => {}}
        onUnwrap={() => {}}
        conditionFields={[]}
        choicesOf={() => []}
        onBlockAttrs={() => {}}
        onSelectField={() => {}}
        place={null}
        onMove={() => {}}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('Конструктор: рядок = запис', () => {
  it('стовпець прив’язується до того, з чим запис створюється; рядки тоді обов’язкові й не змінюються', async () => {
    const onChange = panel('member', [rows, member, note]);
    const binding = screen.getByLabelText('Зв’язок із записом');
    expect(within(binding).getByRole('option', { name: 'Нарахування балів → Учасник' })).toBeInTheDocument();
    // «Нарахував» запис отримує сам: стовпець до нього не прив’язується.
    expect(within(binding).queryByRole('option', { name: 'Нарахування балів → Нарахував' })).not.toBeInTheDocument();
    await userEvent.selectOptions(binding, 'userId');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'member', binding: 'userId', required: true }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'rows1', required: true, editable: false }));
  });

  it('блок рядків з прив’язаними стовпцями: пояснення замість перемикачів; поле поза блоком не прив’язується', () => {
    const bound = { ...member, binding: 'userId', required: true };
    panel('rows1', [{ ...rows, required: true }, bound, note]);
    expect(screen.getByText(/Рядок = запис «Нарахування балів»/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Хоча б один рядок' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Можна змінити після публікації' })).not.toBeInTheDocument();
  });

  it('поле поза блоком, коли стовпці прив’язані, — без варіантів, з поясненням', () => {
    panel('note', [rows, { ...member, binding: 'userId', required: true }, note]);
    const binding = screen.getByLabelText('Зв’язок із записом');
    expect(within(binding).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText(/Записи створюють рядки блоку «Нарахування»/)).toBeInTheDocument();
  });
});

describe('Конструктор: звіт', () => {
  const PLACE: RecordSchema = {
    type: 'place',
    label: 'Обладнання',
    extensible: false,
    version: 'v1',
    fields: [{ key: 'code', label: 'Код', type: 'text', required: true, create: true }],
  };
  const place = field('ref:place', { key: 'place1', label: 'Обладнання' });
  const code = field('text', { key: 'code', label: 'Код', binding: 'code' });

  it('поле запису звіту: пояснення замість зв’язку й перемикачів; стає обов’язковим і незмінним', () => {
    const onChange = panel('place1', [place, code], vi.fn(), 'report', PLACE);
    expect(screen.getByText(/Про цей запис звіт/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Зв’язок із записом')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Обов’язкове' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Можна змінити після публікації' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'place1', required: true, editable: false }));
  });

  it('прив’язане поле звіту — авто: підставиться із запису, без перемикачів', () => {
    panel('code', [{ ...place, required: true }, code], vi.fn(), 'report', PLACE);
    expect(screen.getByText('Підставиться з поля «Код» запису, про який звіт; ніхто не заповнює.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Обов’язкове' })).not.toBeInTheDocument();
  });
});

describe('Конструктор: умовний блок', () => {
  const kind = field('enum', { key: 'kind', label: 'Вид', dictionary: 'kinds' });
  const urgent = field('bool', { key: 'urgent', label: 'Терміново' });
  const due = field('date', { key: 'due', label: 'Термін' });
  const amount = field('int', { key: 'amount', label: 'Сума' });
  const fields = [kind, urgent, due, amount];
  const choices = [
    { key: 'fine', label: 'Штраф' },
    { key: 'old', label: 'Старе', archived: true },
    { key: 'warning', label: 'Попередження' },
  ];

  function block(attrs: Record<string, unknown>, more: Partial<Parameters<typeof BuilderPanel>[0]> = {}) {
    const calls = { attrs: vi.fn(), unwrap: vi.fn(), remove: vi.fn(), move: vi.fn() };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BuilderPanel
          tab="props"
          tabs={['blocks', 'props', 'template']}
          onTab={() => {}}
          palette={{ groups: BLOCK_GROUPS, blocks: BLOCKS }}
          unavailable={() => null}
          settings={null}
          selected={{ kind: 'block', index: 2, node: 'conditional', keys: ['amount'], attrs }}
          defs={new Map(fields.map((f) => [f.key, f]))}
          fields={fields}
          columns={new Map()}
          kind="free"
          schema={null}
          onPick={() => {}}
          onChange={() => {}}
          onRename={() => {}}
          onRemoveField={() => {}}
          onRemoveBlock={calls.remove}
          onUnwrap={calls.unwrap}
          conditionFields={[kind, urgent, due]}
          choicesOf={(f) => (f.key === 'kind' ? choices : [])}
          onBlockAttrs={calls.attrs}
          onSelectField={() => {}}
          place={{ index: 2, count: 4 }}
          onMove={calls.move}
          {...more}
        />
      </QueryClientProvider>,
    );
    return calls;
  }

  it('«Перемістити блок»: «Вгору» — у проміжок перед попереднім, «Вниз» — після наступного; крайні — вимкнено', async () => {
    const calls = block({ field: 'kind', value: 'fine' });
    const group = screen.getByRole('group', { name: 'Перемістити блок' });
    await userEvent.click(within(group).getByRole('button', { name: 'Вгору' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Вниз' }));
    expect(calls.move.mock.calls).toEqual([
      [2, 1],
      [2, 4],
    ]);
    cleanup();
    block({ field: 'kind', value: 'fine' }, { place: { index: 0, count: 1 } });
    expect(screen.getByRole('button', { name: 'Вгору' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Вниз' })).toBeDisabled();
  });

  it('вибір: варіанти без архівних; зміна варіанта', async () => {
    const calls = block({ field: 'kind', value: 'fine' });
    const value = screen.getByLabelText('Має значення');
    expect(
      within(value)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['обрано «Штраф»', 'обрано «Попередження»']);
    await userEvent.selectOptions(value, 'warning');
    expect(calls.attrs).toHaveBeenCalledWith(2, { value: 'warning' });
  });

  it('інше поле — одразу з першим значенням свого виду', async () => {
    const calls = block({ field: 'kind', value: 'fine' });
    const field = screen.getByLabelText('Показувати, якщо поле');
    expect(
      within(field)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Вид', 'Терміново', 'Термін']);
    await userEvent.selectOptions(field, 'urgent');
    expect(calls.attrs).toHaveBeenLastCalledWith(2, { field: 'urgent', value: '@yes' });
    await userEvent.selectOptions(field, 'due');
    expect(calls.attrs).toHaveBeenLastCalledWith(2, { field: 'due', value: '@filled' });
  });

  it('прапорець — позначено чи ні; заповнено — без списку', () => {
    block({ field: 'urgent', value: '@no' });
    expect(
      within(screen.getByLabelText('Має значення'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['позначено', 'не позначено']);
  });

  it('заповнено — пояснення замість списку', () => {
    block({ field: 'due', value: '@filled' });
    expect(screen.queryByLabelText('Має значення')).not.toBeInTheDocument();
    expect(screen.getByText('Блок з’являється, щойно поле заповнено.')).toBeInTheDocument();
  });

  it('поле, яке не може бути умовою, і значення не з варіантів — показані як помилка', () => {
    block({ field: 'amount', value: 'gone' });
    expect(screen.getByLabelText('Показувати, якщо поле')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('option', { name: '«Сума» — не може бути умовою' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '«gone» — немає серед варіантів' })).toBeInTheDocument();
  });

  it('«Прибрати умову» й «Видалити блок»', async () => {
    const calls = block({ field: 'kind', value: 'fine' });
    await userEvent.click(screen.getByRole('button', { name: 'Прибрати умову' }));
    expect(calls.unwrap).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: 'Видалити блок' }));
    expect(calls.remove).toHaveBeenCalledWith(2);
  });

  it('у палітрі блок недоступний з поясненням, коли умові нема на що чекати', () => {
    const why = 'Спершу додайте поле, від якого залежить блок';
    block({ field: 'kind', value: 'fine' }, { tab: 'blocks', unavailable: (b) => (b.kind === 'condition' ? why : null) });
    const button = screen.getByRole('button', { name: 'Умовний блок' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', why);
  });
});
