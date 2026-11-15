import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { COLORS, DEFAULT_FONT_SIZE, FONT_SIZES, HEADING_LEVELS, type Align, type FontName, type FontSize, type TextColor } from '../../../shared/editor-schema';
import { Icon, type IconName } from '../components/Icon';
import { PALETTE } from '../lib/palette';
import { useDropdown } from '../lib/useDropdown';
import s from './Ribbon.module.css';

/**
 * The ribbon: «Головна» (text formatting) and «Вставка» (table, page break,
 * the header and «Затверджую» from «Реквізити»).
 * Each button calls a command from extensions.ts and returns the focus to the sheet.
 */

type Tab = 'home' | 'insert';
const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'Головна' },
  { key: 'insert', label: 'Вставка' },
];

/** Heading sizes when the text has no own size (shared/editor-schema/paper.css). */
const HEADING_SIZE: Record<number, FontSize> = { 1: 16, 2: 14, 3: 14 };

const ALIGN_BUTTONS: { value: Align | null; label: string; icon: IconName }[] = [
  { value: null, label: 'Ліворуч', icon: 'alignLeft' },
  { value: 'center', label: 'По центру', icon: 'alignCenter' },
  { value: 'right', label: 'Праворуч', icon: 'alignRight' },
  { value: 'justify', label: 'За шириною', icon: 'alignJustify' },
];

const FONT_LABEL: Record<FontName, string> = { serif: 'Times New Roman', sans: 'e-Ukraine' };
const COLOR_LABEL = Object.fromEntries(PALETTE.map((c) => [c.name, c.label])) as Record<TextColor, string>;

/** What the selection has now: the ribbon shows it. */
function useFormatState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const level = HEADING_LEVELS.find((l) => e.isActive('heading', { level: l })) ?? null;
      const block = level ? 'heading' : 'paragraph';
      const style = e.getAttributes('textStyle') as { size?: FontSize | null; color?: TextColor | null; font?: FontName | null };
      return {
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        level,
        font: style.font ?? 'serif',
        size: style.size ?? (level ? HEADING_SIZE[level]! : DEFAULT_FONT_SIZE),
        ownSize: style.size ?? null,
        color: style.color ?? null,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        align: ((e.getAttributes(block) as { align?: Align | null }).align ?? null) as Align | null,
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        inTable: e.isActive('table'),
        canMerge: e.can().mergeCells(),
        canSplit: e.can().splitCell(),
        // The header and «Затверджую» stand only on the sheet's top level (not in a list, a table or a zone).
        canStructure: e.can().insertContent({ type: 'orgHeader' }),
      };
    },
  });
}

/** Why formatting does not apply where the cursor is (a document from a template): its text, or a plain zone. */
export type RibbonLock = 'template' | 'plain';

const LOCK_TEXT: Record<RibbonLock, string> = {
  template: 'Тут текст шаблону: змінюються лише поля в панелі «Поля» і вільні зони в рамках.',
  plain: 'Ця зона — лише текст, без форматування.',
};
/** The phone: fields are in «Форма», the line is short. */
const MINI_LOCK_TEXT: Record<RibbonLock, string> = {
  template: 'Текст шаблону: пишіть у рамках, поля — у «Формі».',
  plain: 'Ця зона — лише текст, без форматування.',
};

/**
 * `lock` — why formatting does not apply where the cursor is; null — it does.
 * `extra` — the page's own controls at the end (the constructor: «Показати ключі полів»).
 */
export function Ribbon({ editor, lock = null, extra }: { editor: Editor; lock?: RibbonLock | null; extra?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('home');
  const id = useId();
  const f = useFormatState(editor);
  const run = () => editor.chain().focus();

  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next.key);
    document.getElementById(`${id}-${next.key}`)?.focus();
  };

  return (
    <div className={s.ribbon}>
      <div role="tablist" aria-label="Стрічка" className={s.tabs} onKeyDown={tabKeys}>
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`${id}-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            className={s.tab}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={s.panel}>
        {lock && (
          <p className={s.lock} role="status">
            {LOCK_TEXT[lock]}
          </p>
        )}
        <fieldset className={s.controls} disabled={!!lock}>
          {tab === 'home' ? (
            <>
              <Group label="Історія">
                <IconButton icon="undo" label="Скасувати (Ctrl+Z)" disabled={!f.canUndo} onClick={() => run().undo().run()} />
                <IconButton icon="redo" label="Повторити (Ctrl+Y)" disabled={!f.canRedo} onClick={() => run().redo().run()} />
              </Group>
              <Group label="Стиль і шрифт">
                <select
                  className={`${s.select} ${s.style}`}
                  aria-label="Стиль абзацу"
                  value={f.level ?? 0}
                  onChange={(e) => {
                    const level = Number(e.target.value) as 0 | (typeof HEADING_LEVELS)[number];
                    if (level) run().setHeading({ level }).run();
                    else run().setParagraph().run();
                  }}
                >
                  <option value={0}>Звичайний</option>
                  {HEADING_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      Заголовок {l}
                    </option>
                  ))}
                </select>
                <select
                  className={`${s.select} ${s.font}`}
                  aria-label="Шрифт"
                  value={f.font}
                  onChange={(e) =>
                    run()
                      .setFont(e.target.value === 'serif' ? null : (e.target.value as FontName))
                      .run()
                  }
                >
                  {(Object.keys(FONT_LABEL) as FontName[]).map((k) => (
                    <option key={k} value={k}>
                      {FONT_LABEL[k]}
                    </option>
                  ))}
                </select>
                <select
                  className={`${s.select} ${s.size}`}
                  aria-label="Розмір шрифту, пт"
                  value={f.size}
                  onChange={(e) => {
                    const size = Number(e.target.value) as FontSize;
                    const own = f.level ? HEADING_SIZE[f.level] : DEFAULT_FONT_SIZE;
                    // The block's own size is kept as no size: the document stays free of needless classes.
                    run()
                      .setFontSize(size === own ? null : size)
                      .run();
                  }}
                >
                  {FONT_SIZES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Group>
              <Group label="Накреслення">
                <LetterButton letter="Ж" label="Жирний (Ctrl+B)" active={f.bold} className={s.bold} onClick={() => run().toggleBold().run()} />
                <LetterButton letter="К" label="Курсив (Ctrl+I)" active={f.italic} className={s.italic} onClick={() => run().toggleItalic().run()} />
                <LetterButton letter="П" label="Підкреслений (Ctrl+U)" active={f.underline} className={s.underline} onClick={() => run().toggleUnderline().run()} />
                <LetterButton letter="З" label="Закреслений" active={f.strike} className={s.strike} onClick={() => run().toggleStrike().run()} />
                <ColorButton color={f.color} onPick={(c) => run().setTextColor(c).run()} />
              </Group>
              <Group label="Абзац">
                {ALIGN_BUTTONS.map((a) => (
                  <IconButton key={a.label} icon={a.icon} label={a.label} active={f.align === a.value} onClick={() => run().setAlign(a.value).run()} />
                ))}
              </Group>
              <Group label="Списки й відступи">
                <IconButton icon="listBullet" label="Маркований список" active={f.bulletList} onClick={() => run().toggleBulletList().run()} />
                <IconButton icon="listOrdered" label="Нумерований список" active={f.orderedList} onClick={() => run().toggleOrderedList().run()} />
                <IconButton icon="outdent" label="Зменшити відступ" onClick={() => run().outdent().run()} />
                <IconButton icon="indent" label="Збільшити відступ" onClick={() => run().indent().run()} />
              </Group>
            </>
          ) : (
            <>
              <Group label="Вставити">
                <TablePicker onPick={(rows, cols) => run().insertTable({ rows, cols, withHeaderRow: false }).run()} />
                <button type="button" className={s.wide} onMouseDown={keepFocus} onClick={() => run().setPageBreak().run()}>
                  <Icon name="pageBreak" size={20} />
                  Розрив сторінки
                </button>
              </Group>
              <Group label="Реквізити">
                <button
                  type="button"
                  className={s.wide}
                  disabled={!f.canStructure}
                  title="Назва закладу й групи з «Реквізитів»"
                  onMouseDown={keepFocus}
                  onClick={() => run().insertContent({ type: 'orgHeader' }).run()}
                >
                  <Icon name="header" size={20} />
                  Шапка
                </button>
                <button
                  type="button"
                  className={s.wide}
                  disabled={!f.canStructure}
                  title="Підписант і посада з «Реквізитів»"
                  onMouseDown={keepFocus}
                  onClick={() => run().insertContent({ type: 'approval' }).run()}
                >
                  <Icon name="shield" size={20} />
                  Затверджую
                </button>
              </Group>
              {f.inTable && (
                <Group label="Таблиця">
                  <TextButton onClick={() => run().addRowBefore().run()}>Рядок вище</TextButton>
                  <TextButton onClick={() => run().addRowAfter().run()}>Рядок нижче</TextButton>
                  <TextButton onClick={() => run().addColumnBefore().run()}>Стовпець ліворуч</TextButton>
                  <TextButton onClick={() => run().addColumnAfter().run()}>Стовпець праворуч</TextButton>
                  {f.canMerge && <TextButton onClick={() => run().mergeCells().run()}>Об&apos;єднати клітинки</TextButton>}
                  {!f.canMerge && f.canSplit && <TextButton onClick={() => run().splitCell().run()}>Розділити клітинку</TextButton>}
                  <TextButton onClick={() => run().deleteRow().run()}>Видалити рядок</TextButton>
                  <TextButton onClick={() => run().deleteColumn().run()}>Видалити стовпець</TextButton>
                  <TextButton onClick={() => run().deleteTable().run()}>Видалити таблицю</TextButton>
                </Group>
              )}
            </>
          )}
        </fieldset>
        {extra}
      </div>
    </div>
  );
}

/**
 * The phone's panel instead of the ribbon (narrower than 900 px): one row —
 * undo, redo, bold, italic, underline, lists. `lock` as in the ribbon.
 */
export function MiniRibbon({ editor, lock = null }: { editor: Editor; lock?: RibbonLock | null }) {
  const f = useFormatState(editor);
  const run = () => editor.chain().focus();
  return (
    <div className={s.mini} role="toolbar" aria-label="Форматування">
      <fieldset className={s.miniControls} disabled={!!lock}>
        <IconButton icon="undo" label="Скасувати" disabled={!f.canUndo} onClick={() => run().undo().run()} />
        <IconButton icon="redo" label="Повторити" disabled={!f.canRedo} onClick={() => run().redo().run()} />
        <span className={s.miniGap} aria-hidden="true" />
        <LetterButton letter="Ж" label="Жирний" active={f.bold} className={s.bold} onClick={() => run().toggleBold().run()} />
        <LetterButton letter="К" label="Курсив" active={f.italic} className={s.italic} onClick={() => run().toggleItalic().run()} />
        <LetterButton letter="П" label="Підкреслений" active={f.underline} className={s.underline} onClick={() => run().toggleUnderline().run()} />
        <span className={s.miniGap} aria-hidden="true" />
        <IconButton icon="listBullet" label="Маркований список" active={f.bulletList} onClick={() => run().toggleBulletList().run()} />
        <IconButton icon="listOrdered" label="Нумерований список" active={f.orderedList} onClick={() => run().toggleOrderedList().run()} />
      </fieldset>
      {lock && (
        <p className={s.miniLock} role="status">
          {MINI_LOCK_TEXT[lock]}
        </p>
      )}
    </div>
  );
}

/** A click on a ribbon button must not take the selection away from the sheet. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={s.group}>
      {children}
    </div>
  );
}

function IconButton(props: { icon: IconName; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={s.button}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={20} />
    </button>
  );
}

function LetterButton(props: { letter: string; label: string; active: boolean; className?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${s.button} ${s.letter} ${props.className ?? ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.letter}
    </button>
  );
}

function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={s.wide} onMouseDown={keepFocus} onClick={onClick}>
      {children}
    </button>
  );
}

function ColorButton({ color, onPick }: { color: TextColor | null; onPick: (c: TextColor | null) => void }) {
  const d = useDropdown();
  const id = useId();
  const pick = (c: TextColor | null) => {
    d.setOpen(false);
    onPick(c);
  };
  const options: { value: TextColor | null; label: string }[] = [{ value: null, label: 'Чорний' }, ...COLORS.map((c) => ({ value: c, label: COLOR_LABEL[c] }))];
  return (
    <div className={s.dropdown} ref={d.root} onKeyDown={d.onKeyDown}>
      <button
        type="button"
        className={`${s.button} ${s.letter}`}
        aria-label={`Колір тексту: ${color ? COLOR_LABEL[color] : 'Чорний'}`}
        title="Колір тексту"
        aria-haspopup="true"
        aria-expanded={d.open}
        aria-controls={id}
        onMouseDown={keepFocus}
        onClick={() => d.setOpen(!d.open)}
      >
        <span className={`${s.colorA} ${color ? s[`ink-${color}`] : s['ink-black']}`}>А</span>
      </button>
      {d.open && (
        <div id={id} role="group" aria-label="Колір тексту" className={`${s.popup} ${s.colors}`}>
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`${s.swatch} ${s[`ink-${o.value ?? 'black'}`]}`}
              aria-label={o.label}
              title={o.label}
              aria-pressed={color === o.value}
              onMouseDown={keepFocus}
              onClick={() => pick(o.value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Table size: a grid up to 8 × 8, chosen by pointing (or arrows) like in Word. */
export const TABLE_GRID = 8;

function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const d = useDropdown();
  const id = useId();
  const [at, setAt] = useState({ r: 1, c: 1 });
  const grid = useRef<HTMLDivElement>(null);
  const focusCell = (r: number, c: number) => {
    setAt({ r, c });
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${r}-${c}"]`)?.focus();
  };
  useEffect(() => {
    if (!d.open) return;
    setAt({ r: 1, c: 1 });
    grid.current?.querySelector<HTMLButtonElement>('[data-cell="1-1"]')?.focus();
  }, [d.open]);
  const arrows = (e: KeyboardEvent) => {
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    const clamp = (v: number) => Math.min(TABLE_GRID, Math.max(1, v));
    focusCell(clamp(at.r + m[0]), clamp(at.c + m[1]));
  };
  const pick = (r: number, c: number) => {
    d.setOpen(false);
    onPick(r, c);
  };
  const cells = Array.from({ length: TABLE_GRID * TABLE_GRID }, (_, i) => ({ r: Math.floor(i / TABLE_GRID) + 1, c: (i % TABLE_GRID) + 1 }));
  return (
    <div className={s.dropdown} ref={d.root} onKeyDown={d.onKeyDown}>
      <button type="button" className={s.wide} aria-haspopup="true" aria-expanded={d.open} aria-controls={id} onClick={() => d.setOpen(!d.open)}>
        <Icon name="table" size={20} />
        Таблиця
      </button>
      {d.open && (
        <div id={id} className={s.popup} role="group" aria-label="Розмір таблиці">
          <div className={s.grid} ref={grid} onKeyDown={arrows}>
            {cells.map(({ r, c }) => (
              <button
                key={`${r}-${c}`}
                type="button"
                data-cell={`${r}-${c}`}
                tabIndex={r === at.r && c === at.c ? 0 : -1}
                className={s.cell}
                aria-label={`${r} × ${c}`}
                data-on={r <= at.r && c <= at.c}
                onMouseEnter={() => setAt({ r, c })}
                onFocus={() => setAt({ r, c })}
                onMouseDown={keepFocus}
                onClick={() => pick(r, c)}
              />
            ))}
          </div>
          <p className={s.gridSize} aria-hidden="true">
            {at.r} × {at.c}
          </p>
        </div>
      )}
    </div>
  );
}
