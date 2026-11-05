import { h } from '../dom.js';
import { api } from '../api.js';
import { sheet, field, toast, errorText, withBusy } from '../ui.js';

// Форма створення чи редагування місця (admin і coordinator).
export function placeForm(place, done) {
  const editing = Boolean(place);
  sheet({
    title: editing ? 'Змінити місце' : 'Нове місце',
    build(body, close) {
      const code = h('input', { class: 'input', id: 'pcode', value: place?.code || '', disabled: editing, maxlength: '60', placeholder: 'SOLDER-01', autocapitalize: 'characters' });
      const title = h('input', { class: 'input', id: 'ptitle', value: place?.title || '', maxlength: '200', required: true });
      const category = h('input', { class: 'input', id: 'pcat', value: place?.category || '', maxlength: '100', placeholder: 'Паяння, 3D-друк, Комп’ютери', required: true });
      const location = h('input', { class: 'input', id: 'ploc', value: place?.location || '', maxlength: '200' });
      const description = h('textarea', { class: 'input', id: 'pdesc', maxlength: '5000' }, place?.description || '');
      const needs = h('input', { type: 'checkbox', id: 'pneeds', checked: place ? place.needsAuthorization : true });
      const excl = h('input', { type: 'checkbox', id: 'pexcl', checked: place ? place.exclusive : true });
      const status = h('select', { class: 'input', id: 'pstatus' },
        ...[['active', 'Працює'], ['maintenance', 'На обслуговуванні'], ['archived', 'В архіві']].map(([v, l]) => h('option', { value: v, selected: place?.status === v }, l)));
      const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
      const submit = h('button', { class: 'btn', type: 'submit' }, editing ? 'Зберегти' : 'Створити');
      const form = h('form', null,
        field({ id: 'pcode', label: 'Код', hint: editing ? 'Код не змінюється, бо він у QR-наліпках.' : 'Латиниця, цифри, _ та -, від 3 символів. Використовується в QR-коді.', control: code }),
        field({ id: 'ptitle', label: 'Назва', control: title }),
        field({ id: 'pcat', label: 'Категорія', control: category }),
        field({ id: 'ploc', label: 'Розташування', control: location }),
        field({ id: 'pdesc', label: 'Опис і правила безпеки', control: description }),
        editing ? field({ id: 'pstatus', label: 'Стан', control: status }) : null,
        h('label', { class: 'check', for: 'pneeds' }, needs, h('span', null, 'Потрібен допуск для роботи на цьому місці')),
        h('div', { class: 'field' }),
        h('label', { class: 'check', for: 'pexcl' }, excl, h('span', null, 'Одночасно може працювати лише одна людина')),
        h('div', { class: 'field' }),
        err,
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Скасувати'), submit));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        const payload = { title: title.value.trim(), category: category.value.trim(), location: location.value.trim(), description: description.value.trim(), needsAuthorization: needs.checked, exclusive: excl.checked };
        await withBusy(submit, async () => {
          try {
            const result = editing
              ? await api.patch(`/places/${place.id}`, { ...payload, status: status.value })
              : await api.post('/places', { ...payload, code: code.value.trim() });
            close();
            toast(editing ? 'Зміни збережено' : 'Місце створено');
            done?.(result);
          } catch (ex) { err.textContent = errorText(ex); err.hidden = false; }
        });
      });
      body.append(form);
    },
  });
}
