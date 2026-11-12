import { Link } from 'react-router';
import { PageHeader } from '../components/ui';

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
