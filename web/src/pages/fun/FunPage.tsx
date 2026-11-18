import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/ui';
import { useRooms } from './bunker/queries';
import s from './bunker/bunker.module.css';

/** «Розваги»: games for the team. One for now. */
export function FunPage() {
  const rooms = useRooms().data;
  const waiting = rooms?.items.filter((r) => r.status === 'lobby').length ?? 0;
  return (
    <>
      <PageHeader title="Розваги" />
      <p className={s.lead}>Ігри для команди після пар і на перервах. Балів не дають.</p>
      <div className={s.games}>
        <Link to="/fun/bunker" className={s.game}>
          <span className={s.gameHead}>
            <span className={s.gameIcon}>
              <Icon name="bunker" size={30} />
            </span>
            <span>
              <span className={s.gameTitle}>Бункер</span>
              <span className={`${s.small} ${s.muted}`}> · від 4 до 16 гравців, 30–60 хв</span>
            </span>
          </span>
          <span className={`${s.small} ${s.muted}`}>Після катастрофи місць у бункері лише на половину. Переконайте інших, що саме ви потрібні для виживання.</span>
          {waiting > 0 && <span className={`${s.pill} ${s.pillOk}`}>{waiting === 1 ? 'Кімната збирає гравців' : `Кімнат збирають гравців: ${waiting}`}</span>}
        </Link>
      </div>
    </>
  );
}
