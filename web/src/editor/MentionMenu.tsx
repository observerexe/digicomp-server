import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { RecordType } from '../api/types';
import { candidatesQuery, recordLabel, useSettled, type RecordView } from '../lib/records';
import type { MentionMenuState } from './mention';
import s from './SuggestMenu.module.css';

/** What «@» refers to, in this order. */
export const MENTION_TYPES: RecordType[] = ['user', 'task', 'project', 'place', 'inventory_item'];
/** At most this many of each type. */
const PER_TYPE = 5;

/** Group titles of the list. */
const GROUP: Partial<Record<RecordType, string>> = {
  user: 'Учасники',
  task: 'Технічні завдання',
  project: 'Проєкти',
  place: 'Обладнання',
  inventory_item: 'Склад',
};

/**
 * The list after «@»: records of every type whose title (or code) has what is
 * typed after it, grouped. Arrows and Enter choose (`keys` — the editor
 * passes its keys here while the list is open), Esc closes, a click picks.
 */
export function MentionMenu({ menu, keys }: { menu: MentionMenuState; keys: RefObject<(e: KeyboardEvent) => boolean> }) {
  const q = useSettled(menu.query.trim());
  const found = useQueries({ queries: MENTION_TYPES.map((type) => candidatesQuery(type, q)) });
  const groups = MENTION_TYPES.map((type, i) => ({ type, found: found[i]! }));
  const items: RecordView[] = groups.flatMap((g) => (g.found.data ?? []).filter((c) => c.type === g.type).slice(0, PER_TYPE));
  const pending = groups.some((g) => g.found.isPending);
  // The choice starts from the top for every new search.
  const [sel, setSel] = useState({ q, at: 0 });
  const at = sel.q === q ? sel.at : 0;
  const setAt = (i: number) => setSel({ q, at: i });
  const index = Math.min(at, Math.max(items.length - 1, 0));

  // The editor's keys come here through `keys`; the latest items and choice each time.
  const latest = useRef({ items, index, pick: menu.pick, setAt });
  latest.current = { items, index, pick: menu.pick, setAt };
  useEffect(() => {
    keys.current = (e) => {
      const { items: list, index: i, pick, setAt: move } = latest.current;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.length) move(Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
        return true;
      }
      if (e.key === 'Enter' && list[i]) {
        pick(list[i]);
        return true;
      }
      return false;
    };
    return () => {
      keys.current = () => false;
    };
  }, [keys]);

  const rect = menu.rect;
  let n = -1;
  return (
    <div
      className={s.menu}
      role="listbox"
      aria-label="Посилання на запис"
      // Under the «@»; CSSOM, not the style attribute (CSP).
      style={rect ? { left: Math.max(8, rect.left), top: rect.bottom + 6 } : undefined}
    >
      {items.length === 0 ? (
        <p className={s.note}>{pending ? 'Шукаємо…' : q ? 'Нічого не знайдено' : 'Почніть вводити назву'}</p>
      ) : (
        groups.map((g) => {
          const found = items.filter((c) => c.type === g.type);
          if (!found.length) return null;
          return (
            <div key={g.type} role="group" aria-label={GROUP[g.type] ?? recordLabel(g.type)}>
              <p className={s.group}>{GROUP[g.type] ?? recordLabel(g.type)}</p>
              {found.map((c) => {
                n += 1;
                const i = n;
                return (
                  <div
                    key={c.id}
                    role="option"
                    aria-selected={i === index}
                    className={s.option}
                    // The editor keeps the focus: chosen on press.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      menu.pick(c);
                    }}
                    onMouseEnter={() => setAt(i)}
                  >
                    <span className={s.title}>{c.title}</span>
                    {c.code && <span className={s.sub}>{c.code}</span>}
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}
