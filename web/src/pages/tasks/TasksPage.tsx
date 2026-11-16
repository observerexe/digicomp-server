import { useState } from 'react';
import type { FieldDef, Task } from '../../api/types';
import { Board } from '../../components/Board';
import { useAuth } from '../../auth/AuthProvider';
import { ChoiceButton } from '../../components/ChoiceButton';
import { Chips } from '../../components/Filters';
import { ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { useDictionary, usedItems } from '../../lib/dictionaries';
import { choiceKeys, filterFields, matchesFilters, stripeField, useFieldDefs } from '../../lib/fields';
import { templateChoices, useTemplates } from '../../lib/paperTemplates';
import { COLUMNS, dropAction, type ActionKind } from './logic';
import { DONE_PAGE, useBoard, useTaskAction, useTaskPaper } from './queries';
import { TaskCard } from './TaskCard';
import s from './tasks.module.css';

/**
 * Task board (approved mockups): five columns side by side on a computer with
 * drag and drop, one column per tab on a phone with buttons on the cards.
 */
export function TasksPage() {
  const { user, can } = useAuth();
  const [mine, setMine] = useState(false);
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE);
  const [returning, setReturning] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const board = useBoard(mine, doneLimit);
  const action = useTaskAction(user);
  // «Нове ТЗ» opens a document of a template that creates tasks.
  const staff = can('tasks.create');
  const templates = useTemplates(staff);
  const newTask = useTaskPaper();
  const defs = useFieldDefs('task').data;
  const stripe = stripeField(defs);
  const stripeDict = useDictionary(stripe?.dictionary).data;

  if (!user) return null;
  const run = (task: Task, kind: ActionKind, body?: string) => action.mutate({ task, kind, body });
  const tasks = board.data?.tasks;
  const fields = filterFields(defs);
  const used = (key: string) => (tasks ?? []).flatMap((t) => choiceKeys(t.extra[key]));
  // A chosen item no task holds any more (other tab, «Мої») stops filtering.
  const active = Object.fromEntries(fields.map((f) => [f.key, used(f.key).includes(filters[f.key] ?? '') ? filters[f.key]! : null]));
  const shown = tasks?.filter((t) => matchesFilters(t.extra, active));
  const stripeOf = (t: Task) => {
    const key = stripe && t.extra[stripe.key];
    return typeof key === 'string' ? stripeDict?.items.find((i) => i.key === key) : undefined;
  };

  return (
    <>
      <PageHeader title="Технічні завдання">
        <div className={s.headerTools}>
          <div className={s.segmented} role="group" aria-label="Які завдання показати">
            <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
              Усі
            </button>
            <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
              Мої
            </button>
          </div>
          {staff && (
            <ChoiceButton
              label="Нове технічне завдання"
              choices={templateChoices(templates.data, { creates: 'task' })}
              disabled={templates.isPending || newTask.isPending}
              emptyNote="Немає шаблону, що створює технічні завдання: його додають у «Редактор» → «Шаблони»."
              onPick={(templateId) => templateId && newTask.mutate({ templateId })}
            />
          )}
        </div>
      </PageHeader>
      {fields.length > 0 && (
        <div className={s.filters}>
          {fields.map((f) => (
            <FieldChips key={f.key} def={f} used={used(f.key)} value={active[f.key] ?? null} onChange={(v) => setFilters((x) => ({ ...x, [f.key]: v }))} />
          ))}
        </div>
      )}
      <ErrorMessage text={[action, board, newTask, templates].map((q) => (q.isError ? errorOf(q.error) : null)).find(Boolean) ?? null} />
      <Board
        columns={COLUMNS.map((c) => ({ key: c.status, title: c.title }))}
        items={shown}
        columnOf={(t) => t.status}
        canDrop={(t, to) => !!dropAction(t, to, user, can)}
        onDrop={(t, to) => {
          const kind = dropAction(t, to, user, can);
          if (kind === 'return') setReturning(t.id);
          else if (kind) run(t, kind);
        }}
        hint={{
          phone: 'Беріть технічні завдання самі. Поки ніхто не почав роботу, до завдання можна приєднатися.',
          desk:
            'Перетягніть картку, щоб змінити статус.' +
            (can('tasks.accept') ? ' Прийняти чи повернути можна лише чуже технічне завдання; бали діляться порівну між виконавцями.' : ''),
        }}
        empty={(k) => (Object.values(active).some(Boolean) ? 'Нічого не знайдено.' : k === 'todo' ? 'Вільних технічних завдань немає.' : 'Порожньо.')}
        footer={(k) =>
          k === 'done' && board.data?.moreDone ? (
            <button type="button" className="btn btn-ghost" onClick={() => setDoneLimit((n) => n + DONE_PAGE)}>
              Показати ще
            </button>
          ) : null
        }
        renderCard={(t, drag) => (
          <TaskCard
            key={t.id}
            task={t}
            me={user}
            busy={action.isPending && action.variables?.task.id === t.id}
            onAction={(kind, body) => run(t, kind, body)}
            drag={drag}
            returning={returning === t.id}
            setReturning={(v) => setReturning(v ? t.id : null)}
            stripe={stripeOf(t)}
          />
        )}
      />
    </>
  );
}

/** Filter by a choice field: the items tasks on the board hold, in the dictionary order. */
function FieldChips(props: { def: FieldDef; used: string[]; value: string | null; onChange: (v: string | null) => void }) {
  const dict = useDictionary(props.def.dictionary).data;
  return <Chips label={props.def.label} options={usedItems(dict, props.used)} value={props.value} onChange={props.onChange} />;
}
