import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PaperField } from '../../api/types';
import type { RecordView } from '../../lib/records';
import { json, member, mockApi, moderator } from '../../test/render';
import type { Me } from '../../api/types';
import { AuthProvider, ME_KEY } from '../../auth/AuthProvider';
import { MemoryRouter } from 'react-router';
import type { FieldValue } from '../../../../shared/editor-schema/fields';
import { PaperRecordsContext, type PaperRecords } from '../records';
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
  dictionary: null,
  plain: false,
  binding: null,
  canFill: true,
  auto: false,
  columns: null,
  ...over,
});

/** The widget with its value kept (as the page does) and a label pointing at its control. */
function widget(field: PaperField, initial?: FieldValue, opts: { disabled?: boolean; known?: RecordView[]; me?: Me } = {}) {
  const onChange = vi.fn();
  const onJump = vi.fn();
  const { Widget, group } = fieldType(field.type);
  const known = new Map((opts.known ?? []).map((r) => [`${r.type}:${r.id}`, r]));
  const records: PaperRecords = { get: (type, id) => known.get(`${type}:${id}`), add: (r) => void known.set(`${r.type}:${r.id}`, r) };
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        {!group && field.type !== 'richtext' && <label htmlFor="w">Поле</label>}
        <Widget
          id="w"
          field={field}
          value={value}
          disabled={opts.disabled ?? false}
          onChange={(v) => {
            onChange(v);
            setValue(v ?? undefined);
          }}
          onJump={onJump}
        />
      </>
    );
  }
  const harness = (
    <PaperRecordsContext value={records}>
      <Harness />
    </PaperRecordsContext>
  );
  if (opts.me) mockApi({ 'GET /api/auth/me': () => json(200, opts.me) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      {opts.me ? (
        <AuthProvider>
          <MemoryRouter>{harness}</MemoryRouter>
        </AuthProvider>
      ) : (
        harness
      )}
    </QueryClientProvider>,
  );
  return { onChange, onJump, qc };
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

  describe('вибір із довідника: «Керувати списком»', () => {
    const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'dictionaries.manage'] };
    const options = [{ key: 'video', label: 'Відео' }];

    it.each(['enum', 'list<enum>'])('%s: staff — посилання на довідник', async (type) => {
      widget(f(type, { options, dictionary: 'task_type' }), undefined, { me: staff });
      expect(await screen.findByRole('link', { name: 'Керувати списком' })).toHaveAttribute('href', '/panel/dictionaries/task_type');
    });

    it('учасник посилання не бачить', async () => {
      const { qc } = widget(f('enum', { options, dictionary: 'task_type' }), undefined, { me: member });
      await waitFor(() => expect(qc.getQueryData(ME_KEY)).toEqual(member));
      expect(screen.getByRole('combobox')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('поле не змінюється або вибір без довідника — без посилання', () => {
      widget(f('enum', { options, dictionary: 'task_type' }), 'video', { disabled: true });
      widget(f('enum', { options }));
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
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

  const IVAN: RecordView = { type: 'user', id: 'u-ivan', title: 'Іван Петренко', archived: false };
  const OLHA: RecordView = { type: 'user', id: 'u-olha', title: 'Ольга Бойко', archived: false };
  /** GET /api/links/candidates: people whose name has `q`. */
  const people = () =>
    mockApi({
      'GET /api/links/candidates': (r) => {
        const q = new URL(r.url).searchParams.get('q') ?? '';
        return json(
          200,
          [IVAN, OLHA].filter((p) => p.title.includes(q)),
        );
      },
    });

  it('ref: пошук за назвою, вибір клацанням; «×» — вибрати інше', async () => {
    const { calls } = people();
    const { onChange } = widget(f('ref:user'));
    const input = screen.getByRole('combobox', { name: 'Поле' });
    await userEvent.type(input, 'Оль');
    const list = await screen.findByRole('listbox', { name: 'Знайдено' });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Ольга Бойко']),
    );
    expect(calls.some((c) => c.path === '/api/links/candidates')).toBe(true);
    await userEvent.click(within(list).getByRole('option'));
    expect(onChange).toHaveBeenLastCalledWith('u-olha');
    expect(screen.getByRole('link', { name: 'Ольга Бойко' })).toHaveAttribute('href', '/team/u-olha');
    await userEvent.click(screen.getByRole('button', { name: 'Вибрати інше: Поле' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('ref: стрілки й Enter', async () => {
    people();
    const { onChange } = widget(f('ref:user'));
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: 'Ольга Бойко' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('u-olha');
  });

  it('ref: вибраного видно й без права заповнювати; невидимий — «запис недоступний»', () => {
    widget(f('ref:user'), 'u-ivan', { disabled: true, known: [IVAN] });
    expect(screen.getByRole('link', { name: 'Іван Петренко' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ref: запис, якого читач не бачить', () => {
    widget(f('ref:user'), 'u-gone', { disabled: true });
    expect(screen.getByText('запис недоступний')).toBeInTheDocument();
  });

  it('list<ref:user>: уже вибраний в іншому рядку не пропонується', async () => {
    people();
    const { onChange } = widget(f('list<ref:user>'), ['u-ivan'], { known: [IVAN] });
    await userEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await userEvent.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ольга Бойко']));
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['u-ivan', 'u-olha']);
  });

  it('richtext: перехід до зони на аркуші', async () => {
    const { onJump } = widget(f('richtext', { plain: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Писати на аркуші (лише текст)' }));
    expect(onJump).toHaveBeenCalled();
  });
});
