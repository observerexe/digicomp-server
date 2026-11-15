import { useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { BLOCK_GROUPS, findBlocks, type Block } from './blocks';
import type { BlockMenuState } from './builder';
import s from './SuggestMenu.module.css';

/**
 * The list after «/» in the constructor: blocks whose name starts with what
 * is typed, by groups. Arrows and Enter choose (the editor passes its keys
 * through `keys`), Esc closes, a click picks.
 */
export function BlockMenu({ menu, keys }: { menu: BlockMenuState; keys: RefObject<(e: KeyboardEvent) => boolean> }) {
  const found = findBlocks(menu.query);
  const items = BLOCK_GROUPS.flatMap((g) => found.filter((b) => b.group === g.key));
  const [sel, setSel] = useState({ q: menu.query, at: 0 });
  const at = sel.q === menu.query ? sel.at : 0;
  const setAt = (i: number) => setSel({ q: menu.query, at: i });
  const index = Math.min(at, Math.max(items.length - 1, 0));

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
  const option = (b: Block) => {
    const i = items.indexOf(b);
    return (
      <div
        key={b.key}
        role="option"
        aria-selected={i === index}
        className={`${s.option} ${s.row}`}
        // The editor keeps the focus: chosen on press.
        onMouseDown={(e) => {
          e.preventDefault();
          menu.pick(b);
        }}
        onMouseEnter={() => setAt(i)}
      >
        <span className={s.icon}>
          <Icon name={b.icon} size={18} />
        </span>
        <span className={s.title}>{b.label}</span>
      </div>
    );
  };
  return (
    <div
      className={s.menu}
      role="listbox"
      aria-label="Вставити блок"
      // Under the «/»; CSSOM, not the style attribute (CSP).
      style={rect ? { left: Math.max(8, rect.left), top: rect.bottom + 6 } : undefined}
    >
      {items.length === 0 ? (
        <p className={s.note}>Такого блоку немає</p>
      ) : (
        BLOCK_GROUPS.map((g) => {
          const group = items.filter((b) => b.group === g.key);
          if (!group.length) return null;
          return (
            <div key={g.key} role="group" aria-label={g.label}>
              <p className={s.group}>{g.label}</p>
              {group.map(option)}
            </div>
          );
        })
      )}
    </div>
  );
}
