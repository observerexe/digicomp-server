import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, unwrap } from '../../../api/client';
import type { BunkerRoomListItem } from '../../../api/types';
import { useAuth } from '../../../auth/AuthProvider';
import { Avatar } from '../../../components/Avatar';
import { ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../../components/ui';
import { errorOf } from '../../../errors/messages';
import { PacksTab } from './PacksTab';
import { RoomForm } from './RoomForm';
import { RulesTab } from './RulesTab';
import { roomKey, roomsKey, useRooms } from './queries';
import s from './bunker.module.css';

const TABS = [
  { id: 'rooms', label: 'Кімнати' },
  { id: 'packs', label: 'Карти і паки' },
  { id: 'rules', label: 'Правила' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** «Розваги» → «Бункер»: rooms, cards and packs, rules (the tab is in the address, ?tab=). */
export function BunkerPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'rooms';
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  return (
    <>
      <p className={`${s.small} ${s.muted}`}>
        <Link to="/fun">Розваги</Link> / Бункер
      </p>
      <PageHeader title="Бункер">
        {tab === 'rooms' && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Нова кімната
          </button>
        )}
      </PageHeader>
      <p className={s.lead}>Світ спіткала катастрофа. У бункері місця лише для половини. Розкривайте свої карти, переконуйте й голосуйте, кого взяти.</p>
      <div className={s.tabs} role="tablist" aria-label="Розділи Бункера">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${s.tab} ${tab === t.id ? s.tabOn : ''}`}
            onClick={() => setParams(t.id === 'rooms' ? {} : { tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'rooms' && <RoomsTab />}
      {tab === 'packs' && <PacksTab />}
      {tab === 'rules' && <RulesTab />}
      {creating && (
        <RoomForm
          title="Нова кімната"
          submit="Створити кімнату"
          initial={{ name: `Кімната ${user?.name.split(' ')[0] ?? ''}`.trim() }}
          onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const room = await unwrap(api.POST('/api/bunker/rooms', { body }));
            qc.setQueryData(roomKey(room.id), { room, skew: new Date(room.now).getTime() - Date.now() });
            void qc.invalidateQueries({ queryKey: roomsKey });
            void navigate(`/fun/bunker/${room.id}`);
          }}
        />
      )}
    </>
  );
}

function RoomsTab() {
  const q = useRooms();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  if (q.isPending) return <Skeleton height={200} />;
  if (q.isError) return <ErrorMessage text={errorOf(q.error)} />;
  const { items, myRoomId } = q.data;
  const mine = items.find((r) => r.id === myRoomId);
  const lobby = items.filter((r) => r.status === 'lobby' && r.id !== myRoomId);
  const playing = items.filter((r) => r.status === 'playing' && r.id !== myRoomId);

  /** Moderation: close a room someone else leads (the server decides whose). */
  const closer = (r: BunkerRoomListItem) =>
    can('bunker.moderate') && r.host.id !== user?.id ? (
      <ConfirmButton
        label="Закрити"
        question="Закрити кімнату для всіх?"
        danger
        onConfirm={() =>
          void unwrap(api.DELETE('/api/bunker/rooms/{id}', { params: { path: { id: r.id } } }))
            .then(() => qc.invalidateQueries({ queryKey: roomsKey }))
            .catch((e: unknown) => setError(errorOf(e)))
        }
      />
    ) : null;

  async function join(r: BunkerRoomListItem) {
    setJoining(r.id);
    setError(null);
    try {
      const room = await unwrap(api.POST('/api/bunker/rooms/{id}/join', { params: { path: { id: r.id } } }));
      qc.setQueryData(roomKey(room.id), { room, skew: new Date(room.now).getTime() - Date.now() });
      void qc.invalidateQueries({ queryKey: roomsKey });
      void navigate(`/fun/bunker/${r.id}`);
    } catch (e) {
      setError(errorOf(e));
      setJoining(null);
    }
  }

  return (
    <>
      {mine && (
        <div className={s.banner}>
          <span className={s.bannerText}>
            <span className={s.bannerTitle}>Ви в кімнаті «{mine.name}»</span>
            <span className={`${s.small} ${s.muted}`}>
              {mine.status === 'lobby' ? 'Збираємо гравців' : mine.status === 'playing' ? `Раунд ${mine.round} з 5` : 'Гру завершено'}
            </span>
          </span>
          <Link to={`/fun/bunker/${mine.id}`} className="btn btn-primary">
            Повернутися
          </Link>
        </div>
      )}
      <ErrorMessage text={error} />
      <section className={s.section} aria-labelledby="rooms-lobby">
        <h2 id="rooms-lobby" className={s.caption}>
          Збирають гравців
        </h2>
        {lobby.length ? (
          <ul className={s.rooms}>
            {lobby.map((r) => (
              <li key={r.id}>
                <div className={s.room}>
                  <div className={s.roomHead}>
                    <span>
                      <span className={s.roomName}>{r.name}</span>
                      <span className={`${s.small} ${s.muted}`}>
                        {' '}
                        · веде {r.host.name}
                        {r.packs.length ? ` · ${r.packs.map((p) => p.name).join(', ')}` : ''}
                      </span>
                    </span>
                    <span className={`${s.pill} ${s.pillOk}`}>
                      {r.members.length} з {r.maxPlayers}
                    </span>
                  </div>
                  <div className={s.roomFoot}>
                    <span className={s.stack} aria-label={r.members.map((m) => m.name).join(', ')}>
                      {r.members.slice(0, 8).map((m) => (
                        <Avatar key={m.id} name={m.name} url={m.avatarUrl} color={m.color} size={32} />
                      ))}
                    </span>
                    <button type="button" className="btn" disabled={joining !== null || (!!myRoomId && mine?.status !== 'finished')} onClick={() => void join(r)}>
                      Приєднатися
                    </button>
                    {closer(r)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Поки ніхто не збирає гравців. Створіть кімнату — інші побачать її тут.</p>
        )}
      </section>
      {playing.length > 0 && (
        <section className={s.section} aria-labelledby="rooms-playing">
          <h2 id="rooms-playing" className={s.caption}>
            Ідуть зараз
          </h2>
          <ul className={s.rooms}>
            {playing.map((r) => (
              <li key={r.id}>
                <div className={s.room}>
                  <div className={s.roomHead}>
                    <span>
                      <span className={s.roomName}>{r.name}</span>
                      <span className={`${s.small} ${s.muted}`}>
                        {' '}
                        · веде {r.host.name} · у грі {r.alive}
                      </span>
                    </span>
                    <span className={s.pill}>Раунд {r.round} з 5</span>
                  </div>
                  {closer(r)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="hint">Кімнату, де 6 годин нічого не відбувається, сервер прибирає сам.</p>
    </>
  );
}
