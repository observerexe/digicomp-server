import { useState, type DragEvent, type ReactNode } from 'react';
import { Skeleton } from './ui';
import s from './Board.module.css';

export type DragProps = { draggable: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void };

/**
 * Kanban board shared by tasks and projects: columns side by side with mouse
 * drag and drop on a computer, one column per tab on a phone. `canDrop`
 * decides where a card may go (the API checks again).
 */
export function Board<T extends { id: string }, K extends string>(props: {
  columns: { key: K; title: string }[];
  items: T[] | undefined;
  columnOf: (item: T) => K;
  canDrop: (item: T, to: K) => boolean;
  onDrop: (item: T, to: K) => void;
  renderCard: (item: T, drag: DragProps) => ReactNode;
  empty?: (key: K) => string;
  footer?: (key: K) => ReactNode;
  /** Hint above the board: on a phone and on a computer. */
  hint?: { phone: string; desk: string };
}) {
  const [tab, setTab] = useState<K>(props.columns[0]!.key);
  const [dragging, setDragging] = useState<T | null>(null);
  const [over, setOver] = useState<K | null>(null);
  const items = props.items ?? [];
  const list = (k: K) => items.filter((i) => props.columnOf(i) === k);
  const count = (k: K) => (props.items ? list(k).length : '');

  return (
    <>
      {props.hint && (
        <>
          <p className={`hint ${s.hintPhone}`}>{props.hint.phone}</p>
          <p className={`hint ${s.hintDesk}`}>{props.hint.desk}</p>
        </>
      )}
      <div className={s.tabs} role="tablist" aria-label="Колонки">
        {props.columns.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={tab === c.key} className={s.tab} onClick={() => setTab(c.key)}>
            {c.title}
            <span className={s.count}>{count(c.key)}</span>
          </button>
        ))}
      </div>
      <div className={s.board}>
        {props.columns.map((c) => {
          const droppable = !!dragging && props.canDrop(dragging, c.key);
          return (
            <section
              key={c.key}
              className={`${s.column} ${tab === c.key ? s.columnActive : ''} ${over === c.key && droppable ? s.columnOver : ''}`}
              aria-label={c.title}
              data-droppable={droppable || undefined}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setOver(c.key);
              }}
              onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const item = dragging;
                setDragging(null);
                if (item && props.canDrop(item, c.key)) props.onDrop(item, c.key);
              }}
            >
              <h2 className={s.columnTitle}>
                {c.title} <span className={s.count}>{count(c.key)}</span>
              </h2>
              {!props.items ? (
                <>
                  <Skeleton height={140} />
                  <Skeleton height={140} />
                </>
              ) : list(c.key).length === 0 ? (
                <p className={s.empty}>{props.empty?.(c.key) ?? 'Порожньо.'}</p>
              ) : (
                list(c.key).map((item) =>
                  props.renderCard(item, {
                    draggable: props.columns.some((col) => props.canDrop(item, col.key)),
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.id);
                      setDragging(item);
                    },
                    onDragEnd: () => {
                      setDragging(null);
                      setOver(null);
                    },
                  }),
                )
              )}
              {props.footer?.(c.key)}
            </section>
          );
        })}
      </div>
    </>
  );
}
