import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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

function panel(selected: string, fields: FieldDef[], onChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BuilderPanel
        tab="props"
        tabs={['blocks', 'props', 'template']}
        onTab={() => {}}
        palette={{ groups: BLOCK_GROUPS, blocks: BLOCKS }}
        used={new Set()}
        settings={null}
        selected={{ kind: 'field', key: selected, picked: true }}
        defs={new Map(fields.map((f) => [f.key, f]))}
        fields={fields}
        columns={new Map([['member', 'rows1']])}
        kind="creates"
        schema={ENTRY}
        onPick={() => {}}
        onChange={onChange}
        onRename={() => {}}
        onRemoveField={() => {}}
        onRemoveBlock={() => {}}
        onBlockAttrs={() => {}}
        onSelectField={() => {}}
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
