import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../../api/client';
import type { BunkerGame, BunkerPlayer, BunkerRoom } from '../../../api/types';
import { useAuth } from '../../../auth/AuthProvider';
import { Avatar } from '../../../components/Avatar';
import { ChoiceButton } from '../../../components/ChoiceButton';
import { Icon } from '../../../components/Icon';
import { ConfirmButton, ErrorMessage, Skeleton } from '../../../components/ui';
import { errorOf } from '../../../errors/messages';
import { useMediaQuery } from '../../../lib/useMediaQuery';
import { RoomForm, settingsOf } from './RoomForm';
import { EFFECTS_WITH_TARGET, EFFECT_WHEN, KIND_COLOR, KIND_LABEL, logText, namer, places, players as playersText, specialUsable, stayText, timerText } from './labels';
import { roomsKey, useRoom, useRoomChange } from './queries';
import s from './bunker.module.css';

type Ctx = {
  room: BunkerRoom;
  skew: number;
  me: string;
  isHost: boolean;
  name: (id: string | undefined) => string;
  change: ReturnType<typeof useRoomChange>;
  setError: (e: string | null) => void;
};

/** A room of «Бункер» on the whole window: the lobby, the game, its end. Asks the server for news every 2 s. */
export function RoomPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const q = useRoom(id);
  const change = useRoomChange(id);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (q.isPending) {
    return (
      <div className={s.screen}>
        <div className={s.body}>
          <Skeleton height={320} />
        </div>
      </div>
    );
  }
  if (q.isError) {
    const code = q.error instanceof ApiError ? q.error.code : '';
    return (
      <div className={s.screen}>
        <div className={s.body}>
          <div className={s.box}>
            <h1 className={s.boxTitle}>{code === 'BUNKER_ROOM_NOT_FOUND' ? 'Кімнату закрито' : 'Кімната недоступна'}</h1>
            <ErrorMessage text={errorOf(q.error)} />
            <Link to="/fun/bunker" className="btn btn-primary">
              До кімнат
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const { room, skew } = q.data;
  const me = user?.id ?? '';
  const ctx: Ctx = { room, skew, me, isHost: room.hostId === me, name: namer(room.users, me), change, setError };
  const leave = async () => {
    try {
      await unwrap(api.POST('/api/bunker/rooms/{id}/leave', { params: { path: { id } } }));
      void qc.invalidateQueries({ queryKey: roomsKey });
      void navigate('/fun/bunker');
    } catch (e) {
      setError(errorOf(e));
    }
  };
  const close = async () => {
    try {
      await unwrap(api.DELETE('/api/bunker/rooms/{id}', { params: { path: { id } } }));
      void qc.invalidateQueries({ queryKey: roomsKey });
      void navigate('/fun/bunker');
    } catch (e) {
      setError(errorOf(e));
    }
  };

  return (
    <div className={s.screen}>
      <header className={s.top}>
        <Link to="/fun/bunker" className={s.iconBtn} aria-label="До кімнат">
          <Icon name="back" size={22} />
        </Link>
        <span className={s.topTitle}>
          <span className={s.topSub}>
            Бункер · {room.status === 'lobby' ? 'збираємо гравців' : ctx.isHost ? 'ви ведучий' : `веде ${ctx.name(room.hostId)}`}
            {room.game && room.status === 'playing' && ` · раунд ${room.game.round} з 5`}
          </span>
          <h1 className={s.topName}>{room.name}</h1>
        </span>
        {room.game && room.status === 'playing' && <span className={s.pill}>{places(room.game.capacity)}</span>}
        {room.game && <Status ctx={ctx} game={room.game} />}
      </header>
      {error && (
        <div className={s.body}>
          <ErrorMessage text={error} />
        </div>
      )}
      {room.status === 'lobby' || !room.game ? (
        <Lobby ctx={ctx} onLeave={() => void leave()} onClose={() => void close()} />
      ) : (
        <Game ctx={ctx} game={room.game} onLeave={() => void leave()} />
      )}
    </div>
  );
}

/** Runs a change and shows its error by errorCode. */
function useRun(ctx: Ctx) {
  return (p: Promise<unknown>) => {
    ctx.setError(null);
    p.catch((e: unknown) => ctx.setError(errorOf(e)));
  };
}

function Lobby({ ctx, onLeave, onClose }: { ctx: Ctx; onLeave: () => void; onClose: () => void }) {
  const { room, isHost, change } = ctx;
  const run = useRun(ctx);
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();
  const playing = room.members.filter((m) => room.settings.hostPlays || m.userId !== room.hostId).length;
  const capacity = Math.floor(playing / 2);
  const user = (id: string) => room.users.find((u) => u.id === id);

  return (
    <main className={s.body}>
      <aside className={s.side}>
        <div className={s.box}>
          <h2 className={s.caption}>Налаштування</h2>
          <div className={s.chips}>
            {room.packs.map((p) => (
              <span key={p.id} className={s.pill}>
                {p.name}
              </span>
            ))}
            <span className={s.pill}>{timerText(room.settings.turnSeconds)}</span>
            <span className={s.pill}>до {playersText(room.settings.maxPlayers)}</span>
            {!room.settings.hostPlays && <span className={s.pill}>ведучий лише веде</span>}
          </div>
          {isHost && (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Змінити
            </button>
          )}
        </div>
        <p className="hint">Кімнату бачать усі в розділі «Бункер». Приєднатися можна, доки гра не почалася.</p>
      </aside>
      <div className={s.main}>
        <section className={s.box} aria-labelledby="lobby-members">
          <div className={s.row}>
            <h2 id="lobby-members" className={s.label}>
              Гравці
            </h2>
            <span className={`${s.small} ${s.muted}`}>
              {playing} з {room.settings.maxPlayers}
            </span>
          </div>
          <ul className={s.members}>
            {room.members.map((m) => {
              const u = user(m.userId);
              return (
                <li key={m.userId} className={s.member}>
                  <Avatar name={u?.name ?? null} url={u?.avatarUrl} color={u?.color} />
                  <span className={s.memberName}>
                    {ctx.name(m.userId)}
                    {m.userId === room.hostId && (
                      <span className={s.host}>
                        <Icon name="crown" size={12} />
                        ведучий{room.settings.hostPlays ? '' : ', не грає'}
                      </span>
                    )}
                  </span>
                  <span className={`${s.online} ${m.online ? '' : s.offline}`} title={m.online ? 'у мережі' : 'не в мережі'} />
                  {isHost && m.userId !== ctx.me && (
                    <ChoiceButton
                      label="Дії"
                      className="btn btn-ghost"
                      choices={[
                        { id: 'host', title: 'Зробити ведучим' },
                        { id: 'remove', title: 'Прибрати з кімнати' },
                      ]}
                      onPick={(what) => run(change.member.mutateAsync({ userId: m.userId, what: what as 'host' | 'remove' }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <div className={s.box}>
          <p className={`${s.small} ${s.muted}`}>
            {playing >= 4 ? `${playersText(playing)} — у бункері ${places(capacity)}, вибувають ${playing - capacity}` : `Почати можна від 4 гравців: потрібно ще ${4 - playing}`}
          </p>
          <div className={s.actions}>
            {isHost && (
              <button type="button" className={`btn btn-primary ${s.big}`} disabled={playing < 4 || change.room.isPending} onClick={() => run(change.room.mutateAsync('start'))}>
                Почати гру
              </button>
            )}
            <button type="button" className="btn" onClick={onLeave}>
              Вийти з кімнати
            </button>
            {isHost && <ConfirmButton label="Закрити кімнату" question="Закрити кімнату для всіх?" danger onConfirm={onClose} />}
          </div>
          {!isHost && <p className="hint">Гру почне ведучий, {ctx.name(room.hostId)}.</p>}
        </div>
      </div>
      {editing && (
        <RoomForm
          title="Налаштування кімнати"
          submit="Зберегти"
          initial={settingsOf(room)}
          minPlayers={playing}
          onClose={() => setEditing(false)}
          onSubmit={async (body) => {
            const r = await unwrap(api.PATCH('/api/bunker/rooms/{id}', { params: { path: { id: room.id } }, body }));
            qc.setQueryData(['bunker', 'room', room.id], { room: r, skew: new Date(r.now).getTime() - Date.now() });
            setEditing(false);
          }}
        />
      )}
    </main>
  );
}

/** Seconds left of the turn, by the server's clock. */
function Timer({ deadline, skew }: { deadline: string; skew: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - (now + skew)) / 1000));
  return (
    <span className={`${s.timer} ${left <= 10 ? s.timerLow : ''}`} role="timer" aria-label={`Лишилося ${left} с`}>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  );
}

/** What happens now and the one action that moves the game on. */
function Status({ ctx, game: g }: { ctx: Ctx; game: BunkerGame }) {
  const { me, isHost, change, room } = ctx;
  const run = useRun(ctx);
  const act = (type: 'end_turn' | 'skip_turn' | 'start_vote' | 'close_vote' | 'next_round') => run(change.act.mutateAsync({ type }));
  const busy = change.act.isPending || change.room.isPending;
  let title: string;
  let sub: string;
  let mine = false;
  let action: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean } | null = null;
  if (g.phase === 'turns' && g.turn) {
    mine = g.turn.userId === me;
    title = mine ? 'Ваш хід' : `Говорить ${ctx.name(g.turn.userId)}`;
    sub = mine
      ? g.turn.revealed
        ? 'Розкажіть, чим карта корисна, і завершіть хід'
        : g.round === 1
          ? 'Професію відкрито. Відкрийте ще одну карту'
          : 'Відкрийте одну карту й переконайте інших'
      : `Далі: ${g.queue.slice(1, 3).map(ctx.name).join(', ') || 'обговорення'}`;
    if (mine) action = { label: 'Завершити хід', onClick: () => act('end_turn'), disabled: !g.turn.revealed, primary: true };
    else if (isHost) action = { label: 'Пропустити хід', onClick: () => act('skip_turn') };
  } else if (g.phase === 'discussion') {
    const pending = g.schedule[g.round - 1] ?? 0;
    title = 'Обговорення';
    sub = pending > 0 ? `Далі — голосування: ${pending === 1 ? 'вибуває один' : `вибувають ${pending}`}` : 'Цього раунду ніхто не вибуває';
    if (isHost)
      action =
        pending > 0
          ? { label: 'Почати голосування', onClick: () => act('start_vote'), primary: true }
          : { label: 'Наступний раунд', onClick: () => act('next_round'), primary: true };
    else sub += ` · далі вирішує ведучий`;
  } else if (g.phase === 'voting' && g.vote) {
    const voters = g.players.filter((p) => p.out === null).length;
    title = g.vote.runoff ? 'Переголосування між рівними' : 'Голосування';
    sub = `Проголосували ${g.vote.voted.length} з ${voters}`;
    mine = g.players.some((p) => p.userId === me && p.out === null) && !g.vote.voted.includes(me);
    if (isHost) action = { label: 'Закрити голосування', onClick: () => act('close_vote') };
  } else {
    title = 'Бункер зачинено';
    sub = 'Обговоріть, чи впорається група із загрозою';
    if (isHost) action = { label: 'Зіграти ще раз', onClick: () => run(change.room.mutateAsync('restart')), primary: true };
  }
  return (
    <div className={`${s.status} ${mine ? s.statusMine : ''}`} role="status">
      <span className={s.statusText}>
        <span className={s.statusTitle}>{title}</span>
        <span className={`${s.small} ${s.muted}`}>{sub}</span>
      </span>
      {g.phase === 'turns' && g.turn?.deadline && <Timer deadline={g.turn.deadline} skew={ctx.skew} />}
      {action && (
        <button type="button" className={`btn ${action.primary ? 'btn-primary' : ''}`} disabled={action.disabled || busy} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {room.status === 'finished' && !isHost && <span className="hint">Ще раз — вирішує ведучий</span>}
    </div>
  );
}

const PHONE_TABS = ['me', 'players', 'bunker'] as const;

/** A new vote (and a re-vote) starts with no choice made. */
const voteKey = (g: BunkerGame) => `${g.round}-${g.log.filter((e) => e.type === 'vote' || e.type === 'tie').length}`;

function Game({ ctx, game: g, onLeave }: { ctx: Ctx; game: BunkerGame; onLeave: () => void }) {
  const phone = useMediaQuery('(max-width: 899px)');
  const [tab, setTab] = useState<(typeof PHONE_TABS)[number]>('me');
  const mine = g.players.find((p) => p.userId === ctx.me);
  const alive = g.players.filter((p) => p.out === null).length;
  const voting = g.phase === 'voting' && g.vote && mine && mine.out === null;
  const table = <Table ctx={ctx} game={g} />;
  const cards = <MyCards ctx={ctx} game={g} player={mine} />;
  const list = <Players ctx={ctx} game={g} />;
  const leave = (
    <ConfirmButton label="Вийти з кімнати" question={g.phase === 'finished' || !mine || mine.out !== null ? 'Вийти з кімнати?' : 'Вийти? Ви вибудете з гри.'} onConfirm={onLeave} />
  );
  if (phone) {
    const labels = { me: 'Мої карти', players: `Гравці · ${alive}`, bunker: 'Бункер' };
    return (
      <main className={s.body}>
        {g.phase === 'finished' && <Final ctx={ctx} game={g} />}
        {voting && <Vote key={voteKey(g)} ctx={ctx} game={g} />}
        <div className={s.phoneTabs} role="tablist" aria-label="Що показати">
          {PHONE_TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={s.segment} onClick={() => setTab(t)}>
              {labels[t]}
            </button>
          ))}
        </div>
        {tab === 'me' && cards}
        {tab === 'players' && list}
        {tab === 'bunker' && table}
        {leave}
      </main>
    );
  }
  return (
    <main className={s.body}>
      <aside className={s.side}>{table}</aside>
      <div className={s.main}>
        {g.phase === 'finished' && <Final ctx={ctx} game={g} />}
        {voting && <Vote key={voteKey(g)} ctx={ctx} game={g} />}
        {cards}
        {list}
        <div>{leave}</div>
      </div>
    </main>
  );
}

/** Catastrophe, bunker, this round, chronicle. */
function Table({ ctx, game: g }: { ctx: Ctx; game: BunkerGame }) {
  const pending = g.schedule[g.round - 1] ?? 0;
  const strong = new Set(['out', 'lot', 'left', 'removed', 'finished', 'special']);
  // The chronicle's verbs are in the third person: the reader is named by name, not «Ви».
  const logName = namer(ctx.room.users, undefined);
  return (
    <>
      <section className={s.box} aria-labelledby="table-catastrophe">
        <h2 className={s.caption}>Катастрофа</h2>
        <h3 id="table-catastrophe" className={s.boxTitle}>
          {g.catastrophe.title}
        </h3>
        <p className={`${s.small} ${s.muted}`}>{g.catastrophe.text}</p>
      </section>
      <section className={s.box} aria-labelledby="table-bunker">
        <div className={s.row}>
          <h2 id="table-bunker" className={s.caption}>
            Бункер
          </h2>
          <span className={`${s.small} ${s.muted}`}>сидіти {stayText(g.stayMonths)}</span>
        </div>
        <div className={s.capacity}>
          <b>{g.capacity}</b>
          <span className={s.muted}>
            {g.capacity === 1 ? 'місце' : g.capacity < 5 ? 'місця' : 'місць'} на {playersText(g.players.length)}
          </span>
        </div>
        <ul className={s.features}>
          {g.bunker.map((f) => (
            <li key={f.round} className={f.text ? '' : s.closed}>
              <Icon name={f.text ? 'check' : 'lock'} size={18} />
              {f.text ?? `Відкриється в раунді ${f.round}`}
            </li>
          ))}
        </ul>
      </section>
      {g.threat && (
        <section className={s.final} aria-labelledby="table-threat">
          <h2 className={s.caption}>Загроза в бункері</h2>
          <span id="table-threat" className={s.finalTitle}>
            {g.threat.title}
          </span>
          <span className={s.small}>{g.threat.text}</span>
        </section>
      )}
      <section className={s.box} aria-labelledby="table-log">
        {g.phase !== 'finished' && (
          <div className={s.row}>
            <h2 className={s.caption}>Цей раунд</h2>
            <span className={`${s.pill} ${pending ? s.pillWarn : ''}`}>{pending ? `вибуває ${pending}` : 'без вигнання'}</span>
          </div>
        )}
        <h2 id="table-log" className={s.caption}>
          Хроніка
        </h2>
        <ol className={s.log} reversed>
          {[...g.log].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`} className={strong.has(e.type) ? s.logStrong : ''}>
              {logText(e, logName)}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function MyCards({ ctx, game: g, player }: { ctx: Ctx; game: BunkerGame; player: BunkerPlayer | undefined }) {
  const run = useRun(ctx);
  const { change } = ctx;
  const [target, setTarget] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  if (!g.me || !player) {
    return <p className="hint">Ви ведете гру: ваших карт немає, закриті карти гравців вам не видно.</p>;
  }
  const me = g.me;
  const out = player.out !== null;
  const myTurn = g.phase === 'turns' && g.turn?.userId === ctx.me && !g.turn.revealed;
  const busy = change.act.isPending;
  const sp = me.special;
  const others = g.players.filter(
    (p) => p.out === null && p.userId !== ctx.me && (sp.effect !== 'reveal_other' || p.cards.some((c) => c.kind === sp.effectKind && c.text === null)),
  );
  const canUse = !out && !me.specialUsed && g.phase !== 'finished' && specialUsable(sp.effect, g);
  const needsTarget = EFFECTS_WITH_TARGET.includes(sp.effect);
  const use = () => {
    if (needsTarget && !choosing) return setChoosing(true);
    run(change.act.mutateAsync({ type: 'special', ...(needsTarget && target ? { targetId: target } : {}) }).then(() => setChoosing(false)));
  };
  const over = g.phase === 'finished';
  const opened = me.cards.filter((c) => c.revealed).length;

  return (
    <section aria-labelledby="my-cards">
      <div className={s.row}>
        <h2 id="my-cards" className={s.caption}>
          {over ? 'Ваші карти' : `Ваші карти · ${opened} з 8 відкрито`}
        </h2>
        <span className="hint">Закриті бачите лише ви</span>
      </div>
      {out && <p className="hint">Ви вибули в раунді {player.out}. Дивіться далі: усе відкрите видно, голосувати не можна.</p>}
      <ul className={s.mine}>
        {me.cards.map((c) => (
          <li key={c.kind} className={`${s.myCard} ${c.revealed || over ? '' : s.myCardClosed} pal-${KIND_COLOR[c.kind]}`}>
            <span className={s.myCardBody}>
              <span className={s.kind}>
                <span className={s.dot} />
                {KIND_LABEL[c.kind]}
                {c.revealed ? ' · відкрита' : ''}
              </span>
              <span>{c.text}</span>
            </span>
            {!c.revealed && myTurn && (
              <button type="button" className={`btn ${s.btnSmall}`} disabled={busy} onClick={() => run(change.act.mutateAsync({ type: 'reveal', kind: c.kind }))}>
                Відкрити
              </button>
            )}
          </li>
        ))}
        <li className={`${s.myCard} ${s.myCardSpecial} pal-blue`}>
          <span className={s.myCardBody}>
            <span className={s.kind}>
              <Icon name="star" size={14} />
              Особлива умова · {me.specialUsed ? 'використано' : over ? 'не використано' : `раз за гру, ${EFFECT_WHEN[sp.effect]}`}
            </span>
            <span className={s.small}>{sp.text}</span>
            {choosing && (
              <span className="field">
                <label htmlFor="special-target">На кого</label>
                <select id="special-target" value={target ?? ''} onChange={(e) => setTarget(e.target.value || null)}>
                  <option value="">Оберіть гравця</option>
                  {others.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {ctx.name(p.userId)}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </span>
          {!me.specialUsed && !over && (
            <span className={s.actions}>
              <button type="button" className={`btn ${s.btnSmall}`} disabled={!canUse || busy || (choosing && !target)} onClick={use}>
                {choosing ? 'Застосувати' : 'Використати'}
              </button>
              {choosing && (
                <button type="button" className={`btn btn-ghost ${s.btnSmall}`} onClick={() => setChoosing(false)}>
                  Скасувати
                </button>
              )}
            </span>
          )}
        </li>
      </ul>
    </section>
  );
}

function playerState(ctx: Ctx, g: BunkerGame, p: BunkerPlayer): { text: string; cls?: string } {
  if (p.out !== null) return { text: p.left ? `вийшов у раунді ${p.out}` : `вибув у раунді ${p.out}`, cls: '' };
  const member = ctx.room.members.find((m) => m.userId === p.userId);
  if (member && !member.online) return { text: 'не в мережі', cls: s.stateAway };
  if (g.phase === 'turns') {
    if (g.turn?.userId === p.userId) return { text: 'говорить зараз', cls: s.stateNow };
    if (g.queue.includes(p.userId)) return { text: g.queue[1] === p.userId ? 'наступний' : 'у черзі', cls: '' };
    return { text: 'хід зроблено', cls: s.stateDone };
  }
  if (g.phase === 'voting' && g.vote) return g.vote.voted.includes(p.userId) ? { text: 'проголосував', cls: s.stateDone } : { text: 'голосує', cls: '' };
  if (g.immune.includes(p.userId)) return { text: 'захищений від голосів', cls: s.stateNow };
  return { text: g.phase === 'finished' ? 'у бункері' : 'у грі', cls: '' };
}

function Players({ ctx, game: g }: { ctx: Ctx; game: BunkerGame }) {
  const run = useRun(ctx);
  const user = (id: string) => ctx.room.users.find((u) => u.id === id);
  const sorted = [...g.players.filter((p) => p.out === null), ...g.players.filter((p) => p.out !== null)];
  return (
    <section aria-labelledby="players">
      <h2 id="players" className={s.caption}>
        Гравці · {g.players.filter((p) => p.out === null).length} у грі
      </h2>
      <ul className={s.players}>
        {sorted.map((p) => {
          const u = user(p.userId);
          const st = playerState(ctx, g, p);
          const now = g.phase === 'turns' && g.turn?.userId === p.userId;
          const isMember = ctx.room.members.some((m) => m.userId === p.userId);
          return (
            <li key={p.userId} className={`${s.player} ${now ? s.playerNow : ''} ${p.out !== null ? s.playerOut : ''}`}>
              <div className={s.playerHead}>
                <Avatar name={u?.name ?? null} url={u?.avatarUrl} color={p.out !== null ? 'gray' : u?.color} />
                <span className={s.memberName}>
                  <span className={s.playerName}>
                    {ctx.name(p.userId)}
                    {p.userId === ctx.room.hostId && <Icon name="crown" size={14} />}
                  </span>
                  <span className={`${s.playerState} ${st.cls ?? ''}`}>{st.text}</span>
                </span>
              </div>
              {p.cards
                .filter((c) => c.text !== null)
                .map((c) => (
                  <div key={c.kind} className={`${s.seen} pal-${KIND_COLOR[c.kind]}`}>
                    <span className={s.kind}>
                      <span className={s.dot} />
                      {KIND_LABEL[c.kind]}
                    </span>
                    <span>{c.text}</span>
                  </div>
                ))}
              {p.special && (
                <div className={`${s.seen} pal-blue`}>
                  <span className={s.kind}>
                    <Icon name="star" size={12} />
                    Особлива умова{p.specialUsed ? ' · використано' : ''}
                  </span>
                  <span>{p.special.text}</span>
                </div>
              )}
              {p.cards.every((c) => c.text === null) && <span className="hint">Карти ще закриті</span>}
              {ctx.isHost && p.userId !== ctx.me && isMember && (
                <div className={s.playerActions}>
                  <ChoiceButton
                    label="Дії"
                    className="btn btn-ghost"
                    choices={[
                      { id: 'host', title: 'Зробити ведучим' },
                      { id: 'remove', title: p.out === null ? 'Прибрати з гри' : 'Прибрати з кімнати' },
                    ]}
                    onPick={(what) => run(ctx.change.member.mutateAsync({ userId: p.userId, what: what as 'host' | 'remove' }))}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Vote({ ctx, game: g }: { ctx: Ctx; game: BunkerGame }) {
  const run = useRun(ctx);
  const v = g.vote!;
  const [pick, setPick] = useState<string | null>(v.myVote);
  const voters = g.players.filter((p) => p.out === null).length;
  const options = v.candidates.filter((c) => c !== ctx.me);
  const summary = (id: string) =>
    g.players
      .find((p) => p.userId === id)
      ?.cards.filter((c) => c.text)
      .map((c) => c.text)
      .slice(0, 3)
      .join(' · ');
  return (
    <section className={s.box} aria-labelledby="vote-title">
      <h2 id="vote-title" className={s.boxTitle}>
        {v.runoff ? 'Переголосування: кого не беремо?' : 'Кого не беремо в бункер?'}
      </h2>
      <progress className={s.progress} max={voters} value={v.voted.length} aria-label={`Проголосували ${v.voted.length} з ${voters}`} />
      {options.length === 0 ? (
        <p className="hint">Ви серед рівних: голосують інші.</p>
      ) : (
        <fieldset className={s.vote}>
          <legend className="visually-hidden">Оберіть гравця</legend>
          {options.map((id) => {
            const u = ctx.room.users.find((x) => x.id === id);
            return (
              <label key={id} className={s.voteOption}>
                <input type="radio" name="vote" value={id} checked={pick === id} onChange={() => setPick(id)} />
                <Avatar name={u?.name ?? null} url={u?.avatarUrl} color={u?.color} />
                <span className={s.memberName}>
                  <span className={s.playerName}>{ctx.name(id)}</span>
                  <span className={s.playerState}>{summary(id)}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      <p className="hint">
        Голоси таємні: підсумок з’явиться, коли проголосують усі або ведучий закриє голосування. {v.double && 'Ваш голос рахується двічі. '}
        Свій голос можна змінити до того.
      </p>
      {options.length > 0 && (
        <button
          type="button"
          className={`btn btn-primary ${s.big}`}
          disabled={!pick || pick === v.myVote || ctx.change.act.isPending}
          onClick={() => run(ctx.change.act.mutateAsync({ type: 'vote', targetId: pick! }))}
        >
          {v.myVote && pick === v.myVote ? `Ви голосуєте проти: ${ctx.name(pick)}` : pick ? `Голосувати проти: ${ctx.name(pick)}` : 'Оберіть гравця'}
        </button>
      )}
    </section>
  );
}

function Final({ ctx, game: g }: { ctx: Ctx; game: BunkerGame }) {
  const inside = g.players.filter((p) => p.out === null);
  const out = g.players.filter((p) => p.out !== null);
  return (
    <section className={s.box} aria-labelledby="final-title">
      <h2 id="final-title" className={s.boxTitle}>
        Бункер зачинено
      </h2>
      <p>
        Усередині: <b>{inside.map((p) => ctx.name(p.userId)).join(', ')}</b>.
      </p>
      {out.length > 0 && <p className={`${s.small} ${s.muted}`}>Вибули: {out.map((p) => `${ctx.name(p.userId)} (раунд ${p.out})`).join(', ')}</p>}
      <p className="hint">Усі карти відкрито. Обговоріть, чи впорається група із загрозою.</p>
    </section>
  );
}
