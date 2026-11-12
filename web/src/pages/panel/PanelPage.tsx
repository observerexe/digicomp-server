import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/ui';
import s from './panel.module.css';

/** Tasks waiting for review: the counter in the menu and on the panel. */
export function useReviewCount(enabled: boolean) {
  return useQuery({
    queryKey: ['tasks', 'review-count'],
    enabled,
    queryFn: async () => (await unwrap(api.GET('/api/tasks', { params: { query: { status: 'review' } } }))).length,
    staleTime: 60_000,
  });
}

type Tile = { to: string; title: string; note: string; count?: number; permission?: string };

/** Control panel home: what needs attention and where everything lives. */
export function PanelPage() {
  const { can } = useAuth();
  const review = useReviewCount(true);
  const faults = useQuery({
    queryKey: ['faults', 'open-count'],
    queryFn: async () => (await unwrap(api.GET('/api/faults', { params: { query: { status: 'open', limit: '1' } } }))).total,
  });
  const low = useQuery({
    queryKey: ['inventory', 'low-count'],
    queryFn: async () => (await unwrap(api.GET('/api/inventory/items', { params: { query: { lowStock: 'true', limit: '1' } } }))).total,
  });
  const attention: Tile[] = [
    { to: '/tasks', title: 'ТЗ на перевірці', note: 'Прийняти або повернути з коментарем', count: review.data },
    { to: '/panel/faults', title: 'Відкриті несправності', note: 'Взяти в роботу або закрити', count: faults.data },
    { to: '/inventory', title: 'Мало на складі', note: 'Позиції на мінімумі', count: low.data },
  ];
  const sections: Tile[] = [
    { to: '/panel/users', title: 'Учасники й ролі', note: 'Створення, ролі, блокування, допуски', permission: 'users.manage' },
    { to: '/lab', title: 'Обладнання', note: 'Додати, редагувати, допуски', permission: 'places.manage' },
    { to: '/panel/faults', title: 'Несправності', note: 'Відкриті й у роботі', permission: 'faults.close' },
    { to: '/points', title: 'Бали', note: 'Нарахування й історія', permission: 'points.award' },
    { to: '/discipline', title: 'Дисципліна', note: 'Попередження, штрафи, догани', permission: 'discipline.issue' },
    { to: '/lab/journal', title: 'Журнал обладнання', note: 'Фільтри, CSV, друк', permission: 'sessions.export' },
    { to: '/lab/stickers', title: 'Наліпки QR', note: 'Обладнання й склад', permission: 'places.manage' },
    { to: '/docs', title: 'Документи', note: 'Архів і версії', permission: 'documents.manage' },
    { to: '/team', title: 'Команда', note: 'Учасники й профілі' },
  ];
  return (
    <>
      <PageHeader title="Панель керування" />
      <h2 className={s.caption}>Потребує уваги</h2>
      <ul className={s.grid} aria-label="Потребує уваги">
        {attention.map((t) => (
          <li key={t.title}>
            <Link to={t.to} className={`${s.tile} ${t.count ? s.hot : ''}`}>
              <span className={s.count}>{t.count ?? '…'}</span>
              <span className={s.title}>{t.title}</span>
              <span className={s.note}>{t.note}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 className={s.caption}>Розділи</h2>
      <ul className={s.grid} aria-label="Розділи">
        {sections
          .filter((t) => !t.permission || can(t.permission))
          .map((t) => (
            <li key={t.title}>
              <Link to={t.to} className={s.tile}>
                <span className={s.title}>{t.title}</span>
                <span className={s.note}>{t.note}</span>
              </Link>
            </li>
          ))}
      </ul>
    </>
  );
}
