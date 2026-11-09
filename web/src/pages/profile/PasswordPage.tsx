import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import s from './profile.module.css';

const MIN = 8;

/** Changing the password closes every session, so the person signs in again. */
export function PasswordPage() {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => unwrap(api.PATCH('/api/users/me/password', { body: { currentPassword: current, newPassword: next } })),
    onSuccess: () => logout({ notice: 'Пароль змінено. Увійдіть із новим паролем на всіх пристроях.', next: '/profile' }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (next.length < MIN) return setLocal(`Новий пароль — щонайменше ${MIN} символів.`);
    if (next !== repeat) return setLocal('Паролі не збігаються.');
    if (next === current) return setLocal('Новий пароль має відрізнятися від поточного.');
    setLocal(null);
    change.mutate();
  };

  const error = local ?? (change.isError ? errorOf(change.error) : null);
  return (
    <>
      <Link to="/profile" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Профіль
      </Link>
      <PageHeader title="Зміна пароля" />
      <Card>
        <form className={s.form} onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="pw-current">Поточний пароль</label>
            <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw-new">Новий пароль</label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              aria-describedby="pw-hint"
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <span id="pw-hint" className="hint">
              Щонайменше {MIN} символів. Довга фраза з кількох слів надійніша за короткий складний пароль.
            </span>
          </div>
          <div className="field">
            <label htmlFor="pw-repeat">Повторіть новий пароль</label>
            <input id="pw-repeat" type="password" autoComplete="new-password" maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          <p className="hint">Після зміни пароля всі ваші пристрої вийдуть з акаунта.</p>
          <ErrorMessage text={error} />
          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={change.isPending || !current || !next || !repeat}>
              {change.isPending ? 'Змінюємо…' : 'Змінити пароль'}
            </button>
            <Link to="/profile" className="btn btn-ghost">
              Скасувати
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
