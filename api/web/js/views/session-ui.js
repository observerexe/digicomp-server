import { h } from '../dom.js';
import { api } from '../api.js';
import { field, sheet, toast, errorText, withBusy } from '../ui.js';

export function openStartSession(place, done) {
  sheet({
    title: 'Почати роботу',
    build(body, close) {
      const agree = h('input', { type: 'checkbox', id: 'agree' });
      const note = h('textarea', { class: 'input', id: 'note', maxlength: '1000', placeholder: 'Над чим працюєте (необов’язково)' });
      const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
      const submit = h('button', { class: 'btn', type: 'submit' }, 'Почати');
      const form = h('form', null,
        h('p', { class: 'muted' }, `Місце: ${place.title}`),
        h('label', { class: 'check', for: 'agree' }, agree, h('span', null, 'Я ознайомився(лась) з правилами безпеки для цього місця і готовий(а) до роботи.')),
        h('div', { class: 'field' }, h('label', { for: 'note' }, 'Нотатка'), note),
        err,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Скасувати'), submit));
      const key = crypto.randomUUID();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!agree.checked) { err.textContent = 'Підтвердьте правила безпеки.'; err.hidden = false; return; }
        await withBusy(submit, async () => {
          try {
            await api.post(`/places/${encodeURIComponent(place.id)}/sessions`, { safetyConfirmed: true, note: note.value.trim() || undefined, idempotencyKey: key });
            close();
            toast('Сеанс розпочато. Гарної роботи!');
            await done?.();
          } catch (ex) { err.textContent = errorText(ex); err.hidden = false; }
        });
      });
      body.append(form);
    },
  });
}

const CONDITIONS = ['Усе справне', 'Потребує обслуговування', 'Пошкоджено'];

export function openEndSession(session, done) {
  sheet({
    title: 'Завершити сеанс',
    build(body, close) {
      let condition = CONDITIONS[0];
      const note = h('textarea', { class: 'input', id: 'end-note', maxlength: '1000', placeholder: 'Що зроблено, що залишилось (необов’язково)' });
      const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Стан обладнання' });
      const paint = () => { [...chips.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === condition))); };
      CONDITIONS.forEach((c) => chips.append(h('button', { class: 'chip', type: 'button', onclick: () => { condition = c; paint(); } }, c)));
      paint();
      const submit = h('button', { class: 'btn', type: 'submit' }, 'Завершити');
      const form = h('form', null,
        h('p', { class: 'muted' }, `Місце: ${session.place.title}`),
        h('div', { class: 'field' }, h('div', { class: 'label' }, 'Стан обладнання'), chips),
        h('div', { class: 'field' }, h('label', { for: 'end-note' }, 'Нотатка'), note),
        err,
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Назад'), submit));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        await withBusy(submit, async () => {
          try {
            await api.patch(`/work-sessions/${session.id}/end`, { equipmentState: condition, note: note.value.trim() || undefined });
            close();
            toast('Сеанс завершено. Дякуємо!');
            await done?.();
          } catch (ex) { err.textContent = errorText(ex); err.hidden = false; }
        });
      });
      body.append(form);
    },
  });
}
