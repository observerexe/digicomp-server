import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/ui';
import { isGuest } from '../layout/nav';

export function ForbiddenPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Немає доступу" />
      <p className="hint">
        {isGuest(user?.role)
          ? 'Цей розділ — для учасників команди. Гостям доступні Розваги, рейтинг і огляд технічних завдань і проєктів.'
          : 'Цей розділ доступний лише модераторам і адміністраторам.'}
      </p>
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
