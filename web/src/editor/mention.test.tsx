import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Editor, type JSONContent } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RecordView } from '../lib/records';
import { json, mockApi } from '../test/render';
import { paperExtensions } from './extensions';
import { fieldPosition, zoneAtSelection, type TemplateOptions } from './fields';
import type { MentionMenuState } from './mention';
import { MentionMenu } from './MentionMenu';

const TASK: RecordView = { type: 'task', id: '11111111-1111-4111-8111-111111111111', title: 'Корпус', archived: false };
const IVAN: RecordView = { type: 'user', id: '22222222-2222-4222-8222-222222222222', title: 'Іван Петренко', archived: false };
const OLHA: RecordView = { type: 'user', id: '33333333-3333-4333-8333-333333333333', title: 'Ольга Бойко', archived: false };

/** An editor with «@»; `allow` — where it may refer. */
function open(content: JSONContent, allow: (state: EditorState) => boolean = () => true, template?: TemplateOptions) {
  const show = vi.fn<(m: MentionMenuState | null) => void>();
  const editor = new Editor({
    extensions: paperExtensions({
      template,
      mention: { record: (type, id) => [TASK, IVAN].find((r) => r.type === type && r.id === id) ?? null, suggest: { allow, show, key: () => false } },
    }),
    injectCSS: false,
    content,
  });
  return { editor, show };
}

describe('«@» у тексті', () => {
  it('після «@» — список із тим, що введено; вибір вставляє посилання й пробіл', () => {
    const { editor, show } = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ТЗ ' }] }] });
    editor.chain().focus('end').insertContent('@Кор').run();
    const menu = show.mock.calls.at(-1)![0]!;
    expect(menu.query).toBe('Кор');
    menu.pick(TASK);
    expect(editor.getJSON().content![0]!.content).toEqual([
      { type: 'text', text: 'ТЗ ' },
      { type: 'mention', attrs: { type: 'task', id: TASK.id } },
      { type: 'text', text: ' ' },
    ]);
    expect(show).toHaveBeenLastCalledWith(null);
  });

  it('у шаблоні — лише у вільній зоні, яку людина заповнює (не в простій)', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'fieldZone', attrs: { key: 'notes' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'а' }] }] },
        { type: 'fieldZone', attrs: { key: 'goal' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'б' }] }] },
      ],
    };
    const { editor, show } = open(body, (state) => zoneAtSelection(state) === 'notes', {
      plain: new Set(['goal']),
      locked: new Set(),
      fillable: new Set(['notes', 'goal']),
      onFieldClick: () => {},
    });
    editor
      .chain()
      .setTextSelection(fieldPosition(editor, 'goal')! + 3)
      .insertContent(' @Кор')
      .run();
    expect(show.mock.calls.filter(([m]) => m !== null)).toHaveLength(0);
    editor
      .chain()
      .setTextSelection(fieldPosition(editor, 'notes')! + 3)
      .insertContent(' @Кор')
      .run();
    expect(show.mock.calls.at(-1)![0]!.query).toBe('Кор');
  });
});

describe('Список після «@»', () => {
  const candidates = () =>
    mockApi({
      'GET /api/links/candidates': (r) => {
        const type = new URL(r.url).searchParams.get('type');
        return json(
          200,
          [IVAN, OLHA, TASK].filter((c) => c.type === type),
        );
      },
    });
  const show = (menu: MentionMenuState) => {
    const keys = createRef<(e: KeyboardEvent) => boolean>() as RefObject<(e: KeyboardEvent) => boolean>;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MentionMenu menu={menu} keys={keys} />
      </QueryClientProvider>,
    );
    return keys;
  };

  it('групи за типами; стрілки й Enter вибирають', async () => {
    candidates();
    const pick = vi.fn();
    const keys = show({ query: '', rect: null, pick });
    const list = screen.getByRole('listbox', { name: 'Посилання на запис' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
    expect(within(list).getByRole('group', { name: 'Учасники' })).toBeInTheDocument();
    expect(within(list).getByRole('group', { name: 'Технічні завдання' })).toBeInTheDocument();
    expect(keys.current(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(true);
    await waitFor(() => expect(within(list).getByRole('option', { name: 'Ольга Бойко' })).toHaveAttribute('aria-selected', 'true'));
    expect(keys.current(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
    expect(pick).toHaveBeenLastCalledWith(OLHA);
  });

  it('клацання вибирає; інші клавіші — редактору', async () => {
    candidates();
    const pick = vi.fn();
    const keys = show({ query: '', rect: null, pick });
    await userEvent.click(await screen.findByRole('option', { name: 'Корпус' }));
    expect(pick).toHaveBeenLastCalledWith(TASK);
    expect(keys.current(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
  });
});
