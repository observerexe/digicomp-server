import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Me, Role, UserDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Card, ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { ROLE_LABEL } from '../../lib/labels';
import { AuthorizationsSection } from '../lab/AuthorizationsSection';
import { MIN_PASSWORD, PasswordField, PasswordOnce } from './PasswordField';
import { userRights } from './userRights';
import s from './panel.module.css';

export const userKey = (id: string) => ['users', 'one', id] as const;

/** /panel/users/:id: profile fields, role, blocking, password and 2FA, допуски. */
export function ManageUserPage() {
  const { id = '' } = useParams();
  const { user: me } = useAuth();
  const q = useQuery({
    queryKey: userKey(id),
    queryFn: () => unwrap(api.GET('/api/users/{id}', { params: { path: { id } } })),
  });
  const back = (
    <Link to="/panel/users" className="btn btn-ghost">
      <Icon name="back" size={20} />
      Учасники
    </Link>
  );
  if (!me) return null;
  if (q.isPending) {
    return (
      <>
        {back}
        <Skeleton height={320} />
      </>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <>
        {back}
        <PageHeader title={gone ? 'Учасника не знайдено' : 'Не вдалося відкрити'} />
        <ErrorMessage text={gone ? 'Можливо, посилання застаріло.' : errorOf(q.error)} />
      </>
    );
  }
  return (
    <>
      {back}
      <Manage u={q.data} me={me} />
    </>
  );
}

function Manage({ u, me }: { u: UserDetail; me: Me }) {
  const { can } = useAuth();
  const r = userRights(me, u);
  const active = u.active !== false;
  return (
    <>
      <div className={s.person}>
        <Avatar name={u.name} url={u.avatarUrl} size={56} />
        <div className={s.rowMain}>
          <h1 className={s.personName}>{u.name}</h1>
          <span className={s.rowTitle}>
            <span className={s.badge}>{ROLE_LABEL[u.role]}</span>
            {!active && <span className={`${s.badge} ${s.badgeOff}`}>Заблоковано</span>}
            {u.twoFactorEnabled && <span className={`${s.badge} ${s.badgeOk}`}>2FA</span>}
          </span>
          <span className={s.rowSub}>
            {[u.email, u.createdAt && `з ${formatDate(u.createdAt)}`, `${u.pointsTotal} балів`].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
      <div className={s.actions}>
        {active && (
          <Link to={r.self ? '/profile' : `/team/${u.id}`} className="btn btn-ghost">
            {r.self ? 'Мій профіль' : 'Публічний профіль'}
          </Link>
        )}
        {active && can('points.award') && (me.role === 'admin' || !r.self) && (
          <Link to={`/points?user=${u.id}`} className="btn btn-ghost">
            Бали
          </Link>
        )}
        {can('discipline.issue') && (me.role === 'admin' || !r.self) && (
          <Link to={`/discipline?user=${u.id}`} className="btn btn-ghost">
            Дисципліна
          </Link>
        )}
      </div>
      {r.self && <p className="hint">Це ваш акаунт. Ім’я, біо, пароль і 2FA змінюються в профілі; роль і блокування себе тут недоступні.</p>}
      <div className={s.stack}>
        {!r.self && (r.name || r.email || r.bio || r.roleInfo) && <ProfileForm u={u} rights={r} />}
        {!r.self && (r.roles.length > 0 || r.block) && <AccessCard u={u} rights={r} />}
        {(r.resetPassword || r.resetTwoFactor || (r.avatar && !r.self && u.avatarUrl)) && <SecurityCard u={u} rights={r} />}
        {!r.self && !r.roleInfo && !r.block && r.roles.length === 0 && (
          <p className="hint">Модератор не змінює дані інших модераторів і адміністратора. Це робить адміністратор.</p>
        )}
        {can('places.authorize') && <AuthorizationsSection user={{ id: u.id, name: u.name, active }} />}
      </div>
    </>
  );
}

type Rights = ReturnType<typeof userRights>;

function useUserUpdate(u: UserDetail, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; email?: string; bio?: string; position?: string; specialty?: string; role?: Role; active?: boolean }) =>
      unwrap(api.PATCH('/api/users/{id}', { params: { path: { id: u.id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onSuccess?.();
    },
  });
}

function ProfileForm({ u, rights }: { u: UserDetail; rights: Rights }) {
  const initial = { name: u.name, email: u.email ?? '', bio: u.bio, position: u.position, specialty: u.specialty };
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const save = useUserUpdate(u, () => setSaved(true));
  // Only changed fields are sent: an unchanged field never hits a permission check.
  const changed = Object.fromEntries(
    (Object.keys(f) as (keyof typeof f)[]).filter((k) => f[k].trim() !== initial[k]).map((k) => [k, f[k].trim()]),
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setSaved(false);
    setF((v) => ({ ...v, [k]: e.target.value }));
  };
  const invalid = rights.name && !f.name.trim() ? 'Ім’я не може бути порожнім.' : rights.email && !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? 'Перевірте email.' : null;

  return (
    <Card>
      <form
        className={s.form}
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!invalid) save.mutate(changed);
        }}
      >
        <h2 className={s.sectionTitle}>Дані учасника</h2>
        <div className={s.pair}>
          {rights.name && (
            <div className="field">
              <label htmlFor="mu-name">Ім’я</label>
              <input id="mu-name" maxLength={100} value={f.name} onChange={set('name')} />
            </div>
          )}
          {rights.email && (
            <div className="field">
              <label htmlFor="mu-email">Email (логін)</label>
              <input id="mu-email" type="email" maxLength={200} value={f.email} onChange={set('email')} />
            </div>
          )}
          {rights.roleInfo && (
            <>
              <div className="field">
                <label htmlFor="mu-position">Посада</label>
                <input id="mu-position" maxLength={100} value={f.position} onChange={set('position')} />
              </div>
              <div className="field">
                <label htmlFor="mu-specialty">Спеціальність</label>
                <input id="mu-specialty" maxLength={200} value={f.specialty} onChange={set('specialty')} />
              </div>
            </>
          )}
        </div>
        {rights.bio && (
          <div className="field">
            <label htmlFor="mu-bio">Біо</label>
            <textarea id="mu-bio" maxLength={1000} value={f.bio} onChange={set('bio')} />
            <span className="hint">Адміністратор прибирає недоречне біо. Звичайно біо пише сам учасник.</span>
          </div>
        )}
        <ErrorMessage text={invalid ?? (save.isError ? errorOf(save.error) : null)} />
        {saved && !save.isPending && <p role="status" className="hint">Збережено.</p>}
        <span className={s.actions}>
          <button type="submit" className="btn btn-primary" disabled={!!invalid || Object.keys(changed).length === 0 || save.isPending}>
            Зберегти
          </button>
        </span>
      </form>
    </Card>
  );
}

function AccessCard({ u, rights }: { u: UserDetail; rights: Rights }) {
  const [role, setRole] = useState<Role>(u.role);
  const update = useUserUpdate(u);
  const active = u.active !== false;
  return (
    <Card>
      <div className={s.form}>
        <h2 className={s.sectionTitle}>Роль і доступ</h2>
        {rights.roles.length > 0 ? (
          <div className={s.actions}>
            <div className="field">
              <label htmlFor="mu-role">Роль</label>
              <select id="mu-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {rights.roles.map((x) => (
                  <option key={x} value={x}>
                    {ROLE_LABEL[x]}
                  </option>
                ))}
              </select>
            </div>
            {role !== u.role && (
              <ConfirmButton
                label="Змінити роль"
                question={`${u.name}: ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[role]}?`}
                disabled={update.isPending}
                onConfirm={() => update.mutate({ role })}
              />
            )}
          </div>
        ) : (
          <p className="hint">Роль: {ROLE_LABEL[u.role]}. Змінити її може адміністратор.</p>
        )}
        {rights.block && (
          <div className={s.actions}>
            {active ? (
              <ConfirmButton
                label="Заблокувати"
                question={`Заблокувати ${u.name}? Учасник одразу вийде з усіх пристроїв.`}
                danger
                disabled={update.isPending}
                onConfirm={() => update.mutate({ active: false })}
              />
            ) : (
              <ConfirmButton label="Розблокувати" question={`Розблокувати ${u.name}?`} disabled={update.isPending} onConfirm={() => update.mutate({ active: true })} />
            )}
            <span className="hint">{active ? 'Заблокований не входить і зникає з команди й рейтингу. Дані й історія зберігаються.' : 'Учасник заблокований.'}</span>
          </div>
        )}
        <ErrorMessage text={update.isError ? errorOf(update.error) : null} />
      </div>
    </Card>
  );
}

function SecurityCard({ u, rights }: { u: UserDetail; rights: Rights }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const reset = useMutation({
    mutationFn: (newPassword: string) => unwrap(api.POST('/api/users/{id}/reset-password', { params: { path: { id: u.id } }, body: { newPassword } })),
    onSuccess: (_, sent) => {
      setIssued(sent);
      setPassword('');
    },
  });
  const twoFactor = useMutation({
    mutationFn: () => unwrap(api.POST('/api/users/{id}/2fa/reset', { params: { path: { id: u.id } } })),
    onSuccess: done,
  });
  const avatar = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/users/{id}/avatar', { params: { path: { id: u.id } } })),
    onSuccess: done,
  });
  const error = reset.error ?? twoFactor.error ?? avatar.error;

  return (
    <Card>
      <div className={s.form}>
        <h2 className={s.sectionTitle}>Безпека</h2>
        {rights.resetPassword && (
          <>
            {issued && <PasswordOnce who={u.name} password={issued} />}
            <PasswordField id="mu-password" label="Новий пароль" value={password} onChange={setPassword} />
            <span className={s.actions}>
              <ConfirmButton
                label="Скинути пароль"
                question={`Скинути пароль ${u.name}? Усі сеанси учасника завершаться.`}
                danger
                disabled={password.length < MIN_PASSWORD || reset.isPending}
                onConfirm={() => reset.mutate(password)}
              />
            </span>
          </>
        )}
        {rights.resetTwoFactor && u.twoFactorEnabled && (
          <span className={s.actions}>
            <ConfirmButton
              label="Скинути 2FA"
              question={`Вимкнути вхід із кодом для ${u.name}? Учасник налаштує його знову.`}
              danger
              disabled={twoFactor.isPending}
              onConfirm={() => twoFactor.mutate()}
            />
            <span className="hint">Якщо учасник загубив телефон із застосунком-автентифікатором.</span>
          </span>
        )}
        {rights.avatar && !rights.self && u.avatarUrl && (
          <span className={s.actions}>
            <ConfirmButton label="Прибрати аватар" question="Прибрати недоречний аватар?" disabled={avatar.isPending} onConfirm={() => avatar.mutate()} />
          </span>
        )}
        <ErrorMessage text={error ? errorOf(error) : null} />
      </div>
    </Card>
  );
}
