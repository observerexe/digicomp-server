import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { BunkerRoom } from '../../../api/types';
import { Icon } from '../../../components/Icon';
import { ErrorMessage } from '../../../components/ui';
import { errorOf } from '../../../errors/messages';
import { usePacks } from './queries';
import s from './bunker.module.css';

export type RoomSettings = { name: string; packIds: string[]; maxPlayers: number; turnSeconds: 30 | 60 | 120 | null; hostPlays: boolean };

const TIMES: { value: RoomSettings['turnSeconds']; label: string }[] = [
  { value: 30, label: '30 с' },
  { value: 60, label: '1 хв' },
  { value: 120, label: '2 хв' },
  { value: null, label: 'Без' },
];

/**
 * «Нова кімната» and the host's settings of a lobby: a dialog on a computer,
 * a sheet at the bottom on a phone. Esc or a tap on the dimmed page closes it.
 */
export function RoomForm(props: {
  title: string;
  submit: string;
  initial: Partial<RoomSettings> & { name: string };
  /** In the lobby: as many players as are already in it. */
  minPlayers?: number;
  onSubmit: (v: RoomSettings) => Promise<unknown>;
  onClose: () => void;
}) {
  const packs = usePacks().data?.items;
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<RoomSettings>({ packIds: [], maxPlayers: 12, turnSeconds: 60, hostPlays: true, ...props.initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The built-in pack is chosen by default for a new room.
  const builtin = packs?.find((p) => p.builtin)?.id;
  useEffect(() => {
    if (builtin && !props.initial.packIds) setV((x) => (x.packIds.length ? x : { ...x, packIds: [builtin] }));
  }, [builtin, props.initial.packIds]);
  const close = useRef(props.onClose);
  useEffect(() => {
    close.current = props.onClose;
  });
  useEffect(() => {
    nameRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const min = Math.max(4, props.minPlayers ?? 4);
  const togglePack = (id: string) => setV((x) => ({ ...x, packIds: x.packIds.includes(id) ? x.packIds.filter((p) => p !== id) : [...x.packIds, id] }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({ ...v, name: v.name.trim() });
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className={s.backdrop} aria-hidden="true" onClick={props.onClose} />
      <form className={s.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <div className={s.sheetHead}>
          <h2 id={titleId} className={s.sheetTitle}>
            {props.title}
          </h2>
          <button type="button" className={s.iconBtn} aria-label="Закрити" onClick={props.onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="field">
          <label htmlFor="room-name">Назва</label>
          <input id="room-name" ref={nameRef} required maxLength={60} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </div>
        <fieldset className={s.vote}>
          <legend className={s.label}>Паки карт</legend>
          <div className={s.chips}>
            {(packs ?? []).map((p) => (
              <button key={p.id} type="button" className={s.toggle} aria-pressed={v.packIds.includes(p.id)} onClick={() => togglePack(p.id)}>
                {v.packIds.includes(p.id) && <Icon name="check" size={16} />}
                {p.name}
              </button>
            ))}
          </div>
          <span className="hint">Чого в паках бракує, гра добере з Базового.</span>
        </fieldset>
        <div className={s.vote}>
          <span className={s.label} id={`${titleId}-time`}>
            Час на хід
          </span>
          <div className={s.segments} role="radiogroup" aria-labelledby={`${titleId}-time`}>
            {TIMES.map((t) => (
              <button key={t.label} type="button" role="radio" aria-checked={v.turnSeconds === t.value} className={s.segment} onClick={() => setV({ ...v, turnSeconds: t.value })}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className={s.row}>
          <span>
            <span className={s.label}>Гравців до</span>
            <span className="hint"> · почати можна від 4</span>
          </span>
          <span className={s.stepper}>
            <button type="button" className="btn" aria-label="Менше гравців" disabled={v.maxPlayers <= min} onClick={() => setV({ ...v, maxPlayers: v.maxPlayers - 1 })}>
              −
            </button>
            <output aria-live="polite">{v.maxPlayers}</output>
            <button type="button" className="btn" aria-label="Більше гравців" disabled={v.maxPlayers >= 16} onClick={() => setV({ ...v, maxPlayers: v.maxPlayers + 1 })}>
              +
            </button>
          </span>
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={!v.hostPlays} onChange={(e) => setV({ ...v, hostPlays: !e.target.checked })} />
          <span>
            Я лише веду
            <span className="hint"> · ведучий не отримує карт і не голосує</span>
          </span>
        </label>
        <ErrorMessage text={error} />
        <button type="submit" className={`btn btn-primary ${s.big}`} disabled={busy || !v.name.trim()}>
          {props.submit}
        </button>
      </form>
    </>
  );
}

export function settingsOf(r: BunkerRoom): RoomSettings {
  return {
    name: r.name,
    packIds: r.settings.packIds,
    maxPlayers: r.settings.maxPlayers,
    turnSeconds: r.settings.turnSeconds as RoomSettings['turnSeconds'],
    hostPlays: r.settings.hostPlays,
  };
}
