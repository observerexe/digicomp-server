import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Card, PageHeader, Skeleton } from '../components/ui';

/** Screen that is built in stage 8: real title, skeletons instead of emptiness. */
function Section({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div style={{ display: 'grid', gap: 12 }}>
        <Card>
          <p className="hint" style={{ margin: 0 }}>
            {note}
          </p>
        </Card>
        <Skeleton />
        <Skeleton />
        <Skeleton height={64} />
      </div>
    </>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const first = user?.name.split(/\s+/)[0] ?? '';
  return <Section title={`Добрий день, ${first}`} note="Тут будуть ваш активний сеанс, ТЗ, бали й найближчі бронювання." />;
}

export function ForbiddenPage() {
  return (
    <>
      <PageHeader title="Немає доступу" />
      <p className="hint">Цей розділ доступний лише модераторам і адміністраторам.</p>
      <Link to="/" className="btn">
        На головну
      </Link>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Сторінку не знайдено" />
      <p className="hint">Можливо, посилання застаріло. Перевірте адресу або поверніться на головну.</p>
      <Link to="/" className="btn">
        На головну
      </Link>
    </>
  );
}
