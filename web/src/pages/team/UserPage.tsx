import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { plural } from '../../lib/format';
import { ROLE_LABEL } from '../../lib/labels';
import s from './team.module.css';

/** Another member's public profile: avatar, name, position, specialty, bio, points. */
export function UserPage() {
  const { id = '' } = useParams();
  const { user: me, can } = useAuth();
  const q = useQuery({
    queryKey: ['users', 'one', id],
    queryFn: () => unwrap(api.GET('/api/users/{id}', { params: { path: { id } } })),
    enabled: id !== me?.id,
  });

  if (id === me?.id) return <Navigate to="/profile" replace />;

  const back = (
    <Link to="/team" className="btn btn-ghost">
      <Icon name="back" size={20} />
      Команда
    </Link>
  );

  if (q.isPending) {
    return (
      <>
        {back}
        <Skeleton height={220} />
      </>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <>
        {back}
        <PageHeader title={gone ? 'Учасника не знайдено' : 'Не вдалося відкрити профіль'} />
        <ErrorMessage text={gone ? 'Можливо, посилання застаріло або учасника заблоковано.' : errorOf(q.error)} />
      </>
    );
  }

  const u = q.data;
  return (
    <>
      {back}
      <Card>
        <div className={s.profile}>
          <Avatar name={u.name} url={u.avatarUrl} size={96} />
          <div className={s.profileText}>
            <h1 className={s.profileName}>{u.name}</h1>
            <p className={s.meta}>{[u.position, u.specialty].filter(Boolean).join(' · ')}</p>
            {u.role !== 'member' && <span className={s.role}>{ROLE_LABEL[u.role]}</span>}
          </div>
        </div>
        {u.bio ? <p className={s.fullBio}>{u.bio}</p> : <p className="hint">Біо ще не заповнене.</p>}
        {(can('users.manage') || can('points.award') || can('discipline.issue')) && (
          <div className={s.staffActions}>
            {can('users.manage') && (
              <Link to={`/panel/users/${u.id}`} className="btn">
                Керувати
              </Link>
            )}
            {can('points.award') && (
              <Link to={`/points?user=${u.id}`} className="btn">
                Нарахувати бали
              </Link>
            )}
            {can('discipline.issue') && (
              <Link to={`/discipline?user=${u.id}`} className="btn btn-ghost">
                Дисципліна
              </Link>
            )}
          </div>
        )}
        <p className={s.points}>
          <span className={s.pointsValue}>{u.pointsTotal}</span> {plural(u.pointsTotal, ['бал', 'бали', 'балів'])} за весь час
        </p>
      </Card>
    </>
  );
}
