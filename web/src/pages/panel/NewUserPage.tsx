import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Me } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { MIN_PASSWORD, PasswordField, PasswordOnce } from './PasswordField';
import s from './panel.module.css';

const EMPTY = { name: '', email: '', password: '', position: '', specialty: '' };

/** /panel/users/new: a member with a password (invitations are deferred, docs/tech/ARCHITECTURE.md). */
export function NewUserPage() {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [created, setCreated] = useState<{ user: Me; password: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/users', {
          body: {
            name: f.name.trim(),
            email: f.email.trim(),
            password: f.password,
            position: f.position.trim() || undefined,
            specialty: f.specialty.trim() || undefined,
          },
        }),
      ),
    onSuccess: (user) => {
      setCreated({ user, password: f.password });
      setF(EMPTY);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const invalid = !f.name.trim()
    ? 'Вкажіть ім’я.'
    : !/^\S+@\S+\.\S+$/.test(f.email.trim())
      ? 'Вкажіть email — це логін учасника.'
      : f.password.length < MIN_PASSWORD
        ? `Пароль — щонайменше ${MIN_PASSWORD} символів.`
        : null;

  return (
    <>
      <Link to="/panel/users" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Учасники
      </Link>
      <PageHeader title="Новий учасник" />
      {created && (
        <div className={s.stack}>
          <PasswordOnce who={created.user.name} password={created.password} />
          <span className={s.actions}>
            <Link to={`/panel/users/${created.user.id}`} className="btn btn-primary">
              До учасника
            </Link>
            <button type="button" className="btn btn-ghost" onClick={() => setCreated(null)}>
              Додати ще одного
            </button>
          </span>
        </div>
      )}
      {!created && (
        <Card>
          <form
            className={s.form}
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!invalid) create.mutate();
            }}
          >
            <div className={s.pair}>
              <div className="field">
                <label htmlFor="nu-name">Ім’я</label>
                <input id="nu-name" maxLength={100} autoComplete="off" value={f.name} onChange={set('name')} />
              </div>
              <div className="field">
                <label htmlFor="nu-email">Email</label>
                <input id="nu-email" type="email" maxLength={200} autoComplete="off" value={f.email} onChange={set('email')} />
              </div>
              <div className="field">
                <label htmlFor="nu-position">Посада</label>
                <input id="nu-position" maxLength={100} value={f.position} onChange={set('position')} />
              </div>
              <div className="field">
                <label htmlFor="nu-specialty">Спеціальність</label>
                <input id="nu-specialty" maxLength={200} value={f.specialty} onChange={set('specialty')} />
              </div>
            </div>
            <PasswordField id="nu-password" label="Пароль" value={f.password} onChange={(password) => setF((v) => ({ ...v, password }))} />
            <p className="hint">Новий акаунт отримує роль «Учасник». Підвищити до модератора можна на його сторінці.</p>
            <ErrorMessage text={invalid && (f.name || f.email) ? invalid : create.isError ? errorOf(create.error) : null} />
            <span className={s.actions}>
              <button type="submit" className="btn btn-primary" disabled={!!invalid || create.isPending}>
                {create.isPending ? 'Створюємо…' : 'Створити'}
              </button>
            </span>
          </form>
        </Card>
      )}
    </>
  );
}
