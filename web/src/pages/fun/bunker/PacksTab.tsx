import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, unwrap } from '../../../api/client';
import type { BunkerCard, BunkerCardKind, BunkerEffect, BunkerPackDetail, BunkerPersonalKind } from '../../../api/types';
import { Icon } from '../../../components/Icon';
import { ConfirmButton, ErrorMessage, Skeleton } from '../../../components/ui';
import { errorOf } from '../../../errors/messages';
import { useDebounced } from '../../../lib/useDebounced';
import { CARD_KINDS, EFFECTS, EFFECTS_WITH_KIND, EFFECT_LABEL, KIND_COLOR, KIND_LABEL, PERSONAL_KINDS, TITLED, textMax } from './labels';
import { cardsKey, packKey, packsKey, usePacks } from './queries';
import s from './bunker.module.css';

/** Kinds a game of 16 needs at least this many of; fewer — the game takes the rest from the built-in pack. */
const FULL: Record<BunkerCardKind, number> = Object.fromEntries(CARD_KINDS.map((k) => [k, k === 'catastrophe' || k === 'threat' ? 1 : k === 'bunker' ? 5 : 16])) as Record<
  BunkerCardKind,
  number
>;

const GROUP_SHOWN = 5;

/** «Карти і паки»: packs on the left, the chosen one in the middle, all cards on the right. */
export function PacksTab() {
  const packs = usePacks();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const items = packs.data?.items ?? [];
  const chosen = params.get('pack') ?? items.find((p) => p.canEdit)?.id ?? items[0]?.id ?? null;
  const pick = (id: string) => setParams({ tab: 'packs', pack: id });

  const refresh = (p?: BunkerPackDetail) => {
    if (p) qc.setQueryData(packKey(p.id), p);
    void qc.invalidateQueries({ queryKey: packsKey });
    void qc.invalidateQueries({ queryKey: cardsKey });
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const p = await unwrap(api.POST('/api/bunker/packs', { body: { name: name.trim() } }));
      refresh(p);
      pick(p.id);
      setNaming(false);
      setName('');
    } catch (err) {
      setError(errorOf(err));
    }
  }

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      setError('Файл не схожий на пак Бункера: потрібен .json, який дає «Експорт».');
      return;
    }
    try {
      const p = await unwrap(api.POST('/api/bunker/packs/import', { body: body as never }));
      refresh(p);
      pick(p.id);
    } catch (err) {
      setError(errorOf(err));
    }
  }

  if (packs.isPending) return <Skeleton height={320} />;
  if (packs.isError) return <ErrorMessage text={errorOf(packs.error)} />;
  return (
    <div className={s.packsLayout}>
      <section aria-label="Паки" className={s.side}>
        {naming ? (
          <form className={s.newCard} onSubmit={create}>
            <div className="field">
              <label htmlFor="pack-name">Назва паку</label>
              <input id="pack-name" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className={s.actions}>
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                Створити
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setNaming(false)}>
                Скасувати
              </button>
            </div>
          </form>
        ) : (
          <div className={s.actions}>
            <button type="button" className="btn" onClick={() => setNaming(true)}>
              <Icon name="plus" size={18} />
              Новий пак
            </button>
            <label className="btn btn-ghost">
              Імпорт
              <input type="file" accept="application/json,.json" className="visually-hidden" onChange={(e) => void importFile(e)} />
            </label>
          </div>
        )}
        <ErrorMessage text={error} />
        <ul className={s.packList}>
          {items.map((p) => (
            <li key={p.id}>
              <a
                href={`?tab=packs&pack=${p.id}`}
                className={s.packLink}
                aria-current={p.id === chosen}
                onClick={(e) => {
                  e.preventDefault();
                  pick(p.id);
                }}
              >
                <span className={s.packName}>
                  {p.name}
                  {p.builtin && <Icon name="lock" size={14} />}
                </span>
                <span className={`${s.small} ${s.muted}`}>
                  {p.builtin ? 'вбудований' : (p.author?.name ?? 'автора немає')} · {p.cardCount} карт
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      {chosen ? <PackEditor id={chosen} onChanged={refresh} onDeleted={() => setParams({ tab: 'packs' })} onCopied={(p) => pick(p.id)} /> : <p className="hint">Паків ще немає.</p>}
      <Library packId={chosen} onChanged={refresh} />
    </div>
  );
}

function PackEditor(props: { id: string; onChanged: (p?: BunkerPackDetail) => void; onDeleted: () => void; onCopied: (p: BunkerPackDetail) => void }) {
  const q = useQuery({ queryKey: packKey(props.id), queryFn: () => unwrap(api.GET('/api/bunker/packs/{id}', { params: { path: { id: props.id } } })) });
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<BunkerCardKind[]>([]);
  const p = q.data;
  useEffect(() => {
    if (p) setName(p.name);
  }, [p]);

  const run = async (fn: () => Promise<BunkerPackDetail | { ok: true }>) => {
    setError(null);
    try {
      const r = await fn();
      props.onChanged('id' in r ? r : undefined);
      return r;
    } catch (e) {
      setError(errorOf(e));
      return null;
    }
  };

  if (q.isPending) return <Skeleton height={320} />;
  if (q.isError || !p) return <ErrorMessage text={errorOf(q.error)} />;
  const path = { params: { path: { id: p.id } } };
  const rename = () => name.trim() && name.trim() !== p.name && void run(() => unwrap(api.PATCH('/api/bunker/packs/{id}', { ...path, body: { name: name.trim() } })));
  const copy = async () => {
    const r = await run(() => unwrap(api.POST('/api/bunker/packs', { body: { name: `${p.name} (копія)`.slice(0, 60), copyOf: p.id } })));
    if (r && 'id' in r) props.onCopied(r);
  };
  const exportFile = async () => {
    try {
      const file = await unwrap(api.GET('/api/bunker/packs/{id}/export', path));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      a.download = `${p.name}.bunker.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(errorOf(e));
    }
  };
  const low = p.counts.filter((c) => c.count < FULL[c.kind]);

  return (
    <section className={s.panel} aria-label={`Пак «${p.name}»`}>
      <div className={s.actions}>
        {p.canEdit ? (
          <div className={`field ${s.grow}`}>
            <label htmlFor="pack-title">Назва паку</label>
            <input id="pack-title" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && rename()} />
          </div>
        ) : (
          <h2 className={`${s.boxTitle} ${s.grow}`}>{p.name}</h2>
        )}
        <button type="button" className="btn" onClick={() => void copy()}>
          Копія
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void exportFile()}>
          Експорт
        </button>
        {p.canEdit && (
          <ConfirmButton
            label="Видалити"
            question="Видалити пак? Карти лишаться в бібліотеці."
            danger
            onConfirm={() => void run(() => unwrap(api.DELETE('/api/bunker/packs/{id}', path))).then((r) => r && props.onDeleted())}
          />
        )}
      </div>
      {p.description && <p className={`${s.small} ${s.muted}`}>{p.description}</p>}
      {p.builtin && <p className="hint">Вбудований пак не змінюється. Щоб змінити, зробіть копію.</p>}
      <ErrorMessage text={error} />
      <div>
        <h3 className={s.caption}>Скільки карт кожного виду</h3>
        <div className={s.counts}>
          {p.counts.map((c) => (
            <span key={c.kind} className={`${s.count} ${c.count < FULL[c.kind] ? s.countLow : ''}`}>
              <span>{KIND_LABEL[c.kind]}</span>
              <b>{c.count}</b>
            </span>
          ))}
        </div>
        {low.length > 0 && <p className="hint">Персональних карт і умов треба стільки, скільки гравців (до 16). Чого бракує, гра добере з Базового.</p>}
      </div>
      {p.cards.length === 0 && <p className="hint">Карт у паку ще немає. Додайте їх зі списку «Усі карти» або створіть нову.</p>}
      {CARD_KINDS.map((kind) => {
        const all = p.cards.filter((c) => c.kind === kind);
        if (!all.length) return null;
        // A long group shows its first cards; «Ще N» opens the rest.
        const cards = open.includes(kind) ? all : all.slice(0, GROUP_SHOWN);
        return (
          <div key={kind} className={`${s.group} pal-${KIND_COLOR[kind]}`}>
            <h3 className={s.groupHead}>
              <span className={s.dot} />
              {KIND_LABEL[kind]}
              <span className={`${s.small} ${s.muted}`}>{all.length}</span>
            </h3>
            {cards.map((c) =>
              editing === c.id ? (
                <CardForm
                  key={c.id}
                  card={c}
                  onDone={(changed) => {
                    setEditing(null);
                    if (changed) props.onChanged();
                    void q.refetch();
                  }}
                />
              ) : (
                <div key={c.id} className={s.cardRow}>
                  <span className={s.cardText}>
                    {c.title && <b>{c.title}. </b>}
                    {c.text}
                    {c.author && <span className={s.cardMeta}> · {c.author.name}</span>}
                  </span>
                  {c.canEdit && (
                    <button type="button" className={s.iconBtn} aria-label={`Змінити карту «${c.text}»`} onClick={() => setEditing(c.id)}>
                      <Icon name="edit" size={18} />
                    </button>
                  )}
                  {p.canEdit && (
                    <button
                      type="button"
                      className={s.iconBtn}
                      aria-label={`Прибрати з паку «${c.text}»`}
                      onClick={() => void run(() => unwrap(api.DELETE('/api/bunker/packs/{id}/cards/{cardId}', { params: { path: { id: p.id, cardId: c.id } } })))}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  )}
                </div>
              ),
            )}
            {all.length > cards.length && (
              <button type="button" className="btn btn-ghost" onClick={() => setOpen([...open, kind])}>
                Ще {all.length - cards.length}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** «Усі карти»: search the library, add to the chosen pack, make a new card. */
function Library(props: { packId: string | null; onChanged: (p?: BunkerPackDetail) => void }) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<BunkerCardKind | ''>('');
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const q = useDebounced(search);
  const pack =
    useQuery({
      queryKey: packKey(props.packId ?? ''),
      queryFn: () => unwrap(api.GET('/api/bunker/packs/{id}', { params: { path: { id: props.packId! } } })),
      enabled: !!props.packId,
    }).data ?? null;
  const query = { ...(q ? { search: q } : {}), ...(kind ? { kind } : {}), ...(mine ? { mine: 'true' as const } : {}), limit: '30' };
  const list = useQuery({ queryKey: [...cardsKey, query], queryFn: () => unwrap(api.GET('/api/bunker/cards', { params: { query } })) });
  const inPack = new Set(pack?.cards.map((c) => c.id));

  const add = async (c: BunkerCard) => {
    if (!pack) return;
    setError(null);
    try {
      props.onChanged(await unwrap(api.POST('/api/bunker/packs/{id}/cards', { params: { path: { id: pack.id } }, body: { cardIds: [c.id] } })));
    } catch (e) {
      setError(errorOf(e));
    }
  };

  return (
    <section className={s.panel} aria-label="Усі карти">
      <div className={s.row}>
        <h2 className={s.sheetTitle}>Усі карти</h2>
        {list.data && <span className={`${s.small} ${s.muted}`}>{list.data.total}</span>}
      </div>
      {making ? (
        <CardForm
          packId={pack?.canEdit ? pack.id : undefined}
          onDone={(changed) => {
            setMaking(false);
            if (changed) {
              props.onChanged();
              void list.refetch();
            }
          }}
        />
      ) : (
        <button type="button" className="btn" onClick={() => setMaking(true)}>
          <Icon name="plus" size={18} />
          Нова карта
        </button>
      )}
      <div className="field">
        <label htmlFor="card-search">Пошук</label>
        <input id="card-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="card-kind">Вид</label>
        <select id="card-kind" value={kind} onChange={(e) => setKind(e.target.value as BunkerCardKind | '')}>
          <option value="">Усі види</option>
          {CARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <label className={s.check}>
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
        Лише мої
      </label>
      <ErrorMessage text={error} />
      {list.isPending ? (
        <Skeleton height={160} />
      ) : list.isError ? (
        <ErrorMessage text={errorOf(list.error)} />
      ) : (
        <div className={s.group}>
          {list.data.items.length === 0 && <p className="hint">Нічого не знайдено.</p>}
          {list.data.items.map((c) =>
            editing === c.id ? (
              <CardForm
                key={c.id}
                card={c}
                onDone={(changed) => {
                  setEditing(null);
                  if (changed) {
                    props.onChanged();
                    void list.refetch();
                  }
                }}
              />
            ) : (
              <div key={c.id} className={`${s.cardRow} pal-${KIND_COLOR[c.kind]}`}>
                <span className={s.dot} title={KIND_LABEL[c.kind]} />
                <span className={s.cardText}>
                  {c.title && <b>{c.title}. </b>}
                  {c.text}
                  <span className={s.cardMeta}>
                    {' '}
                    · {KIND_LABEL[c.kind]}
                    {c.author ? ` · ${c.author.name}` : ''}
                  </span>
                </span>
                {c.canEdit && (
                  <button type="button" className={s.iconBtn} aria-label={`Змінити карту «${c.text}»`} onClick={() => setEditing(c.id)}>
                    <Icon name="edit" size={18} />
                  </button>
                )}
                {pack?.canEdit &&
                  (inPack.has(c.id) ? (
                    <span className={`${s.small} ${s.muted}`}>у паку</span>
                  ) : (
                    <button type="button" className={s.iconBtn} aria-label={`Додати в пак «${c.text}»`} onClick={() => void add(c)}>
                      <Icon name="plus" size={18} />
                    </button>
                  ))}
              </div>
            ),
          )}
          {list.data.total > list.data.items.length && (
            <p className="hint">
              Показано {list.data.items.length} з {list.data.total} — уточніть пошук.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** A new card (into `packId`, if given) or a change of `card`. */
function CardForm(props: { card?: BunkerCard; packId?: string; onDone: (changed: boolean) => void }) {
  const c = props.card;
  const [kind, setKind] = useState<BunkerCardKind>(c?.kind ?? 'profession');
  const [title, setTitle] = useState(c?.title ?? '');
  const [text, setText] = useState(c?.text ?? '');
  const [effect, setEffect] = useState<BunkerEffect>(c?.effect ?? 'none');
  const [effectKind, setEffectKind] = useState<BunkerPersonalKind>(c?.effectKind ?? 'health');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titled = TITLED.includes(kind);
  const special = kind === 'special';
  const withKind = special && EFFECTS_WITH_KIND.includes(effect);
  const max = textMax(kind);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      kind,
      title: titled ? title.trim() : '',
      text: text.trim(),
      effect: special ? effect : null,
      effectKind: withKind ? effectKind : null,
    };
    try {
      if (c) {
        await unwrap(api.PATCH('/api/bunker/cards/{id}', { params: { path: { id: c.id } }, body }));
      } else {
        await unwrap(api.POST('/api/bunker/cards', { body: { ...body, ...(props.packId ? { packId: props.packId } : {}) } }));
      }
      props.onDone(true);
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await unwrap(api.DELETE('/api/bunker/cards/{id}', { params: { path: { id: c!.id } } }));
      props.onDone(true);
    } catch (err) {
      setError(errorOf(err));
    }
  }

  return (
    <form className={s.newCard} onSubmit={save} aria-label={c ? 'Змінити карту' : 'Нова карта'}>
      <div className="field">
        <label htmlFor="new-card-kind">Вид</label>
        <select id="new-card-kind" value={kind} onChange={(e) => setKind(e.target.value as BunkerCardKind)}>
          {CARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      {titled && (
        <div className="field">
          <label htmlFor="new-card-title">Назва</label>
          <input id="new-card-title" required maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="new-card-text">Текст</label>
        <textarea id="new-card-text" required maxLength={max} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="hint">
          {text.length} з {max}
        </span>
      </div>
      {special && (
        <div className="field">
          <label htmlFor="new-card-effect">Що робить у грі</label>
          <select id="new-card-effect" value={effect} onChange={(e) => setEffect(e.target.value as BunkerEffect)}>
            {EFFECTS.map((x) => (
              <option key={x} value={x}>
                {EFFECT_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
      )}
      {withKind && (
        <div className="field">
          <label htmlFor="new-card-effect-kind">Яка карта</label>
          <select id="new-card-effect-kind" value={effectKind} onChange={(e) => setEffectKind(e.target.value as BunkerPersonalKind)}>
            {PERSONAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorMessage text={error} />
      <div className={s.actions}>
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim() || (titled && !title.trim())}>
          {c ? 'Зберегти' : props.packId ? 'Зберегти й додати в пак' : 'Зберегти'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => props.onDone(false)}>
          Скасувати
        </button>
        {c && (
          <ConfirmButton
            label="Видалити карту"
            question={c.packCount > 1 ? `Карта є в паках: ${c.packCount}. Видалити звідусіль?` : 'Видалити карту?'}
            danger
            onConfirm={() => void remove()}
          />
        )}
      </div>
    </form>
  );
}
