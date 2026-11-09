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
export const TasksPage = () => <Section title="ТЗ" note="Дошка завдань: беріть ТЗ, здавайте на перевірку, слідкуйте за дедлайнами." />;
export const LabPage = () => <Section title="Лабораторія" note="Обладнання, розумні пристрої й бронювання." />;
export const EquipmentPage = () => <Section title="Обладнання" note="Сторінка обладнання: допуск, «Почати роботу», бронювання, несправності." />;
export const ScanPage = () => <Section title="Сканувати QR" note="Наведіть камеру на QR-наліпку обладнання чи позиції складу." />;
export const ProjectsPage = () => <Section title="Проєкти" note="Дошка проєктів за етапами." />;
export const InventoryPage = () => <Section title="Склад" note="Позиції, залишки, «взяти» й «поповнити»." />;
export const DocsPage = () => <Section title="Архів" note="Документи з версіями: інструкції, паспорти, шаблони." />;
export const RatingPage = () => <Section title="Рейтинг" note="Топ учасників за місяць і за весь час." />;
export const ProfilePage = () => <Section title="Профіль" note="Біо, аватар, бали, допуски, бронювання, вхід із кодом." />;
export const PanelPage = () => <Section title="Панель керування" note="Учасники, бали, дисципліна, ТЗ на перевірці, допуски, обладнання." />;

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
