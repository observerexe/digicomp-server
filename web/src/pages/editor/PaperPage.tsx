import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Paper } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { OfflineBanner } from '../../components/OfflineBanner';
import { DropZone } from '../../components/DropZone';
import { ConfirmButton, ErrorMessage } from '../../components/ui';
import { FieldsPanel, reportRecordKey } from '../../editor/FieldsPanel';
import { setZoneText } from '../../editor/fields';
import { MentionMenu } from '../../editor/MentionMenu';
import { PaperForm } from '../../editor/PaperForm';
import { PaperRecordsContext } from '../../editor/records';
import { useFill, useFillSheet } from '../../editor/useFill';
import type { FieldValue, FieldValues } from '../../../../shared/editor-schema/fields';
import '../../../../shared/editor-schema/paper.css';
import '../../editor/format.css';
import { MiniRibbon, Ribbon } from '../../editor/Ribbon';
import { Ruler } from '../../editor/Ruler';
import { StatusBar, useZoom } from '../../editor/StatusBar';
import { useAutosave, type SaveState } from '../../editor/useAutosave';
import { peopleOf, useSheet } from '../../editor/useSheet';
import { usePageStats } from '../../editor/usePageStats';
import { errorOf } from '../../errors/messages';
import { formatDate, formatTime } from '../../lib/format';
import { PAPER_STATUS_LABEL } from '../../lib/labels';
import { recordHref, recordLabel, type RecordView } from '../../lib/records';
import { useDropdown } from '../../lib/useDropdown';
import { useMediaQuery } from '../../lib/useMediaQuery';
import s from './editor.module.css';
import { PaperLoading } from './PaperLoading';

/**
 * One document, in the whole window (outside the app's sidebar). Loaded lazily
 * (TipTap is a separate chunk). Loaded once: the editor keeps its own state,
 * the server only receives changes.
 */
export function PaperPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const paper = useQuery({
    queryKey: ['papers', 'one', id],
    queryFn: () => unwrap(api.GET('/api/papers/{id}', { params: { path: { id } } })),
    // Our own saves change the revision: a refetch would start a conflict with ourselves.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  // The list shows titles and dates: refresh it when leaving.
  useEffect(() => () => void qc.invalidateQueries({ queryKey: ['papers', 'list'] }), [qc]);
  // A published document being changed (fields «можна змінити»): the editor starts again for it.
  // A record's «Редагувати» opens its document so at once: `navigate(…, { state: { change: true } })`.
  const asked = (useLocation().state as { change?: boolean } | null)?.change === true;
  const [changing, setChanging] = useState(asked);

  if (paper.isPending) return <PaperLoading />;
  if (paper.isError) {
    return (
      <main id="main" className={s.alone}>
        <BackLink />
        <ErrorMessage text={errorOf(paper.error)} />
      </main>
    );
  }
  return (
    <PaperEditor
      key={`${paper.data.id}:${paper.dataUpdatedAt}:${changing && paper.data.canChange}`}
      paper={paper.data}
      changing={changing && paper.data.canChange}
      onChanging={setChanging}
      onReload={() => void paper.refetch()}
    />
  );
}

function BackLink() {
  return (
    <Link to="/editor" className={s.back}>
      <Icon name="back" size={20} />
      Редактор
    </Link>
  );
}

const SAVE_TEXT: Record<Exclude<SaveState, 'saved'>, string> = {
  dirty: 'Зміни ще не збережено',
  saving: 'Збереження…',
  error: 'Не вдалося зберегти, спробуємо ще раз',
  rejected: 'Не збережено',
  conflict: 'Не збережено',
};

const TITLE_MAX = 200;

type PaperChange = { title: string; content: JSONContent; values: FieldValues };

type EditorProps = {
  paper: Paper;
  /** Changing a published document: no autosave, «Зберегти зміни» sends it all at once. */
  changing: boolean;
  onChanging: (on: boolean) => void;
  onReload: () => void;
};

function PaperEditor({ paper, changing, onChanging, onReload }: EditorProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  // A draft the actor fills (saved as they type).
  const filling = paper.canEdit && paper.status === 'draft';
  const editable = filling || (changing && paper.canChange);
  const published = paper.status !== 'draft';
  // A change of a published document, kept here until «Зберегти зміни».
  const pending = useRef<Partial<Pick<PaperChange, 'content' | 'values'>>>({});
  const [dirty, setDirty] = useState(false);
  const keep = (change: Partial<PaperChange>) => {
    if (filling) return autosave.change(change);
    pending.current = { ...pending.current, ...change };
    setDirty(true);
  };
  // A report's draft shows its record as soon as it is chosen: once saved, the record is read anew.
  const onSaved = useRef<(change: Partial<PaperChange>) => void>(() => {});
  const autosave = useAutosave<PaperChange>(
    (change, revision) =>
      unwrap(api.PATCH('/api/papers/{id}', { params: { path: { id: paper.id } }, body: { revision, ...change } })).then((saved) => {
        onSaved.current(change);
        return saved;
      }),
    paper.revision,
  );
  const [title, setTitle] = useState(paper.title);
  const lastTitle = useRef(paper.title);
  const template = paper.template;
  // Narrower than 900 px a document from a template is «Форма» or «Сторінка»; a free one — the page.
  const wide = useMediaQuery('(min-width: 900px)');
  const [view, setView] = useState<'form' | 'page'>('form');
  const formShown = !wide && !!template && view === 'form';
  const fill = useFill({
    template,
    values: paper.values as FieldValues,
    refs: paper.refs as RecordView[],
    editable,
    published,
    // A field touched on the page: its control is in the form.
    showControls: () => {
      if (wide || !template) return false;
      setView('form');
      return true;
    },
  });
  const { values } = fill;
  const recordKey = reportRecordKey(template);
  const shownRecord = useRef(recordKey ? paper.values[recordKey] : undefined);
  onSaved.current = (change) => {
    if (!recordKey || !change.values || change.values[recordKey] === shownRecord.current) return;
    shownRecord.current = change.values[recordKey];
    void unwrap(api.GET('/api/papers/{id}', { params: { path: { id: paper.id } } })).then((p) => fill.takeAuto(p.values as FieldValues, p.refs as RecordView[]));
  };
  const editor = useEditor({
    extensions: fill.extensions,
    content: paper.content,
    editable,
    // TipTap's own <style> is blocked by CSP; its rules are in format.css and paper.css.
    injectCSS: false,
    editorProps: { attributes: { class: `paper ${s.page}`, 'aria-label': 'Текст документа' } },
    onCreate: ({ editor: e }) => fill.syncZones(e.state.doc),
    // The «@» list belongs to the cursor: gone when the sheet loses focus (it comes back as typing goes on).
    onBlur: () => fill.closeMenu(),
    onUpdate: ({ editor: e }) => {
      fill.syncZones(e.state.doc);
      keep({ content: e.getJSON() });
    },
  });
  /** The page shows what the server answered (the editor starts again with it). */
  const replace = (p: Paper) => {
    qc.setQueryData(['papers', 'one', paper.id], p);
    void qc.invalidateQueries({ queryKey: ['papers', 'list'] });
  };
  const publish = useMutation({
    mutationFn: async () => {
      if (!(await autosave.flush())) throw new Error('not saved');
      return unwrap(api.POST('/api/papers/{id}/publish', { params: { path: { id: paper.id } } }));
    },
    onSuccess: (p) => {
      autosave.cancel();
      replace(p);
    },
  });
  const freeze = useMutation({
    mutationFn: () => unwrap(api.POST('/api/papers/{id}/freeze', { params: { path: { id: paper.id } } })),
    onSuccess: replace,
  });
  // The signed scan: the form is open while `scan` is not null (the file chosen, if any).
  const [scan, setScan] = useState<File | null | undefined>(undefined);
  const sign = useMutation({
    mutationFn: () => {
      if (!scan) throw new ApiError(0, 'FILE_REQUIRED');
      if (scan.size > SCAN_MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', scan);
      return unwrap(api.POST('/api/papers/{id}/signed', { params: { path: { id: paper.id } }, body: body as never }));
    },
    onSuccess: (p) => {
      setScan(undefined);
      replace(p);
    },
  });
  const [reason, setReason] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => unwrap(api.POST('/api/papers/{id}/cancel', { params: { path: { id: paper.id } }, body: { reason: (reason ?? '').trim() } })),
    onSuccess: replace,
  });
  // Unsaved changes stop the publication: the autosave's own message says why.
  const publishError = publish.error instanceof ApiError ? publish.error : null;
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH('/api/papers/{id}', { params: { path: { id: paper.id } }, body: { revision: paper.revision, ...pending.current } })),
    onSuccess: () => {
      onChanging(false);
      onReload();
    },
  });
  const saveError = save.error instanceof ApiError ? save.error : null;

  // A value the server refused (on saving or publishing): its field is shown (the error says what to fix).
  const refused = autosave.state === 'rejected' ? (autosave.rejection?.field ?? null) : (publishError?.field ?? saveError?.field ?? null);
  const sheet = useFillSheet(editor, fill, refused);
  useSheet(editor, {
    author: paper.author.name,
    publishedAt: paper.publishedAt,
    number: paper.number,
    people: template ? peopleOf(template.fields, values, fill.recordTitle) : {},
  });

  // A draft never sends what the record shows (a report's auto fields): nobody fills it.
  // A change of a published document sends everything it shows: the server compares.
  const changeValue = (key: string, v: FieldValue | null) => {
    const next = fill.change(key, v);
    keep({ values: filling ? Object.fromEntries(Object.entries(next).filter(([k]) => !template?.fields.find((f) => f.key === k)?.auto)) : next });
  };
  /** A zone from the form: to it on the page, the cursor in it. */
  const toPage = (key: string) => {
    setView('page');
    requestAnimationFrame(() => sheet.showField(key, true));
  };
  const [zoom, setZoom, zoomClass] = useZoom();
  const stats = usePageStats(editor, zoom);

  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/papers/{id}', { params: { path: { id: paper.id } } })),
    onMutate: () => autosave.cancel(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['papers', 'list'] });
      void navigate('/editor');
    },
  });
  const copy = useMutation({
    mutationFn: () => {
      const name = `${lastTitle.current} (копія)`.slice(0, TITLE_MAX);
      // Only what the actor fills: the copy is their own draft.
      const own = Object.fromEntries(Object.entries(values).filter(([k]) => template?.fields.find((f) => f.key === k)?.canFill));
      return unwrap(api.POST('/api/papers/{id}/copy', { params: { path: { id: paper.id } }, body: { title: name, content: editor.getJSON(), values: own } }));
    },
    onSuccess: (p) => void navigate(`/editor/${p.id}`),
  });

  const changeTitle = (v: string) => {
    setTitle(v);
    const t = v.trim();
    if (!t) return; // An empty title is not saved; on leaving the field the last one returns.
    lastTitle.current = t;
    autosave.change({ title: t });
  };

  /**
   * The print page in a new tab, after the changes are saved: a frozen document's
   * snapshot, otherwise a preview marked as not final. The tab opens at once
   * (a tab opened after waiting is blocked as a pop-up), the address comes after.
   */
  const preview = () => {
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.opener = null;
    void autosave.flush().then(() => tab.location.replace(`/api/papers/${paper.id}/print`));
  };

  const saveText = autosave.state === 'saved' ? (autosave.savedAt ? `Збережено о ${formatTime(autosave.savedAt)}` : '') : SAVE_TEXT[autosave.state];
  const saved = (
    <span className={s.saved} role="status" aria-live="polite">
      {saveText}
    </span>
  );
  const actions = changing ? (
    <>
      <button type="button" className="btn btn-ghost" disabled={save.isPending} onClick={() => onChanging(false)}>
        Скасувати
      </button>
      <button type="button" className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
        Зберегти зміни
      </button>
    </>
  ) : (
    <>
      {paper.canChange && (
        <button type="button" className="btn" onClick={() => onChanging(true)}>
          Змінити
        </button>
      )}
      <button type="button" className="btn" onClick={preview}>
        {paper.snapshot ? 'Друк' : 'Попередній перегляд'}
      </button>
      {editable && (
        <ConfirmButton
          label="Видалити чернетку"
          question="Видалити чернетку назавжди?"
          confirmLabel="Видалити"
          danger
          disabled={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      )}
      {paper.canCancel && reason === null && (
        <button type="button" className="btn" onClick={() => setReason('')}>
          Скасувати документ
        </button>
      )}
      {paper.canPublish && (
        <ConfirmButton label="Опублікувати" question={publishQuestion(paper)} confirmLabel="Опублікувати" primary disabled={publish.isPending} onConfirm={() => publish.mutate()} />
      )}
      {paper.canFreeze &&
        (paper.snapshot ? (
          // A report: each freezing is a new version with its record as it is now.
          <ConfirmButton
            label="Зафіксувати нову версію"
            question="Зафіксувати нову версію? Вона візьме дані запису, які є зараз; попередні версії лишаються."
            confirmLabel="Зафіксувати"
            disabled={freeze.isPending}
            onConfirm={() => freeze.mutate()}
          />
        ) : (
          <ConfirmButton
            label="Зафіксувати для підпису"
            question="Зафіксувати документ? Він стане остаточним: друк і PDF — з цього знімка, з QR-кодом перевірки."
            confirmLabel="Зафіксувати"
            primary
            disabled={freeze.isPending}
            onConfirm={() => freeze.mutate()}
          />
        ))}
      {paper.canSign && scan === undefined && (
        <button type="button" className={`btn ${paper.status === 'frozen' ? 'btn-primary' : ''}`} onClick={() => setScan(null)}>
          {paper.status === 'frozen' ? 'Завантажити підписаний скан' : 'Інший скан'}
        </button>
      )}
    </>
  );
  const groups = template && {
    template,
    values,
    zones: fill.zones,
    conditions: fill.conditions,
    mode: filling ? ('fill' as const) : changing ? ('change' as const) : ('view' as const),
    published: fill.published,
    active: sheet.shownActive,
    onChange: changeValue,
    onActive: sheet.onActive,
  };

  return (
    <div className={s.editor}>
      <header className={s.top}>
        <Link to="/editor" className={s.backButton} aria-label="Назад" title="Назад до списку">
          <Icon name="back" size={20} />
        </Link>
        <div className={s.heading}>
          {wide ? (
            <nav aria-label="Шлях" className={s.path}>
              <Link to="/editor">Редактор</Link> / {paper.author.id === user?.id ? 'Мої' : 'Усі'}
            </nav>
          ) : (
            <span className={s.path}>
              {[template?.title ?? 'Документ', paper.number && `№ ${paper.number}`, PAPER_STATUS_LABEL[paper.status].toLowerCase()].filter(Boolean).join(' · ')}
            </span>
          )}
          <div className={s.titleRow}>
            {filling ? (
              <input
                className={s.titleInput}
                aria-label="Назва документа"
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => changeTitle(e.target.value)}
                onBlur={() => !title.trim() && setTitle(lastTitle.current)}
              />
            ) : (
              <h1 className={s.titleText}>{paper.title}</h1>
            )}
            {wide && paper.number && <span className={s.number}>№ {paper.number}</span>}
            {wide && <span className={s.tag}>{PAPER_STATUS_LABEL[paper.status]}</span>}
          </div>
          {wide && filling && saved}
        </div>
        {wide ? <span className={s.topActions}>{actions}</span> : <MoreMenu>{actions}</MoreMenu>}
      </header>
      {!wide && template && (
        <div className={s.views} role="group" aria-label="Вигляд документа">
          <button type="button" aria-pressed={view === 'form'} onClick={() => setView('form')}>
            Форма
          </button>
          <button type="button" aria-pressed={view === 'page'} onClick={() => setView('page')}>
            Сторінка
          </button>
        </div>
      )}
      <OfflineBanner />
      {editable && (wide ? <Ribbon editor={editor} lock={sheet.ribbonLock} /> : !formShown && <MiniRibbon editor={editor} lock={sheet.ribbonLock} />)}
      <div className={s.notices}>
        <ErrorMessage
          text={
            remove.isError
              ? errorOf(remove.error)
              : copy.isError
                ? errorOf(copy.error)
                : freeze.isError
                  ? errorOf(freeze.error)
                  : saveError
                    ? errorOf(saveError)
                    : autosave.state === 'rejected'
                      ? errorOf(autosave.rejection)
                      : publishError
                        ? errorOf(publishError)
                        : null
          }
        />
        {reason !== null && (
          <form
            className={s.conflict}
            onSubmit={(e) => {
              e.preventDefault();
              cancel.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="paper-cancel-reason">Причина скасування</label>
              <input id="paper-cancel-reason" maxLength={1000} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <p className="hint">{cancelHint(paper)}</p>
            <ErrorMessage text={cancel.isError ? errorOf(cancel.error) : null} />
            <div className={s.conflictActions}>
              <button type="submit" className="btn btn-danger" disabled={!reason.trim() || cancel.isPending}>
                Скасувати документ
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setReason(null)}>
                Назад
              </button>
            </div>
          </form>
        )}
        {scan !== undefined && (
          <form
            className={s.conflict}
            onSubmit={(e) => {
              e.preventDefault();
              sign.mutate();
            }}
          >
            <DropZone
              id="paper-scan"
              label="Вибрати файл"
              file={scan}
              onFile={setScan}
              accept={SCAN_ACCEPT}
              hint="Скан чи фото підписаного паперу: PDF, PNG, JPG або WebP, до 20 МБ."
            />
            <ErrorMessage text={sign.isError ? errorOf(sign.error) : null} />
            <div className={s.conflictActions}>
              <button type="submit" className="btn btn-primary" disabled={!scan || sign.isPending}>
                Завантажити
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setScan(undefined)}>
                Назад
              </button>
            </div>
          </form>
        )}
        {paper.snapshot?.signed && <SignedScan paper={paper} signed={paper.snapshot.signed} />}
        {paper.snapshots.length > 1 && <Versions paper={paper} />}
        {paper.status === 'cancelled' && <p className="hint">Документ скасовано{paper.cancelReason ? `: ${paper.cancelReason}` : ''}.</p>}
        {paper.status !== 'cancelled' && paper.targetType && paper.targetId && <CreatedRecord type={paper.targetType} id={paper.targetId} />}
        {autosave.state === 'conflict' && (
          <div className={s.conflict} role="alert">
            <p>
              Документ змінили в іншому вікні чи іншою людиною, тому ваші останні зміни не збережено. Відкрийте останню версію (ваші зміни зникнуть) або збережіть свій текст
              окремою чернеткою.
            </p>
            <div className={s.conflictActions}>
              <button type="button" className="btn btn-primary" onClick={onReload}>
                Відкрити останню версію
              </button>
              <button type="button" className="btn" disabled={copy.isPending} onClick={() => copy.mutate()}>
                Зберегти мою як копію
              </button>
            </div>
          </div>
        )}
        {!filling && paper.status !== 'cancelled' && <p className="hint">{readHint(paper, changing)}</p>}
      </div>
      <div className={s.work}>
        <main id="main" className={`${s.desk} ${formShown ? s.gone : ''}`} tabIndex={-1}>
          <div className={`${s.paperWrap} ${editable ? '' : s.noRuler} ${zoomClass}`}>
            {editable && wide && (
              <div className={s.ruler}>
                <Ruler editor={editor} />
              </div>
            )}
            <EditorContent editor={editor} className={s.sheet} />
          </div>
        </main>
        {groups && (wide || formShown) && (
          <PaperRecordsContext value={fill.records}>
            {wide ? (
              <FieldsPanel {...groups} onJump={(key) => sheet.showField(key, true)} />
            ) : (
              <PaperForm {...groups} onJump={toPage} onZoneText={(key, text) => setZoneText(editor, key, text)} saved={saved} />
            )}
          </PaperRecordsContext>
        )}
      </div>
      {fill.menu && <MentionMenu menu={fill.menu} keys={fill.menuKeys} />}
      {!formShown && (
        <StatusBar
          stats={stats}
          zoom={zoom}
          onZoom={setZoom}
          hints={editable ? [...(template?.fields.some((f) => f.canFill) ? ['Tab — наступне поле'] : []), '@ — посилання на запис'] : []}
          lead={wide ? undefined : saved}
        />
      )}
    </div>
  );
}

/** Why the text does not change, or what changes. */
function readHint(paper: Paper, changing: boolean) {
  if (paper.status === 'draft') return 'Це чужа чернетка: її можна лише переглядати.';
  if (paper.snapshot) {
    return paper.canFreeze
      ? 'Документ зафіксовано: друк і PDF — з останньої версії, з QR-кодом перевірки. «Зафіксувати нову версію» візьме дані запису, які є зараз.'
      : 'Документ зафіксовано: друк і PDF — зі знімка, з QR-кодом перевірки.';
  }
  if (changing) {
    const record = paper.targetType ? ` Поля, пов’язані із записом «${recordLabel(paper.targetType)}», змінять і сам запис.` : '';
    return `Змініть поля, які можна змінити, і натисніть «Зберегти зміни».${record}`;
  }
  return paper.canChange ? 'Документ опубліковано. Деякі поля можна змінити: «Змінити».' : 'Документ опубліковано: текст не змінюється.';
}

/** «Рядок = запис»: the template's rows have columns bound to the record — each row makes one. */
function rowsMakeRecords(paper: Paper) {
  return !!paper.template?.fields.some((f) => f.type === 'rows' && f.columns?.some((c) => c.binding));
}

/** What publishing does: a document of a `creates` template makes a record (or one of each row). */
function publishQuestion(paper: Paper) {
  const t = paper.template;
  const record =
    t?.kind === 'creates' && t.target
      ? rowsMakeRecords(paper)
        ? ` Кожен рядок стане записом «${recordLabel(t.target)}».`
        : ` Буде створено запис «${recordLabel(t.target)}».`
      : '';
  return `Опублікувати документ?${record} Після публікації текст не змінюється.`;
}

function cancelHint(paper: Paper) {
  if (!paper.targetType) return 'Документ лишиться з позначкою «Скасовано» і причиною.';
  return paper.targetId
    ? `Разом із документом буде знято запис «${recordLabel(paper.targetType)}».`
    : `Разом із документом буде знято всі його записи «${recordLabel(paper.targetType)}».`;
}

const SCAN_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const SCAN_MAX_BYTES = 20 * 1024 * 1024;

/** The signed scan: a PDF opens in the browser, a photo downloads. */
function SignedScan({ paper, signed }: { paper: Paper; signed: NonNullable<NonNullable<Paper['snapshot']>['signed']> }) {
  const href = `/api/papers/${paper.id}/signed`;
  return (
    <p className="hint">
      Підписаний скан завантажено {formatDate(signed.uploadedAt)}.{' '}
      {signed.mimeType === 'application/pdf' ? (
        <a href={`${href}?inline=1`} target="_blank" rel="noopener noreferrer">
          Відкрити скан
        </a>
      ) : (
        <a href={href} download>
          Завантажити скан
        </a>
      )}
    </p>
  );
}

/** Every version of a report frozen again: each prints its own snapshot. */
function Versions({ paper }: { paper: Paper }) {
  return (
    <p className="hint">
      Версії:{' '}
      {paper.snapshots.map((v, i) => (
        <span key={v.n}>
          {i > 0 && ' · '}
          <a href={`/api/papers/${paper.id}/print?snapshot=${v.n}`} target="_blank" rel="noopener noreferrer" title={`Версія ${v.n} від ${formatDate(v.createdAt)}`}>
            {v.n}
          </a>
        </span>
      ))}
    </p>
  );
}

/** A link to the record the document created. */
function CreatedRecord({ type, id }: { type: NonNullable<Paper['targetType']>; id: string }) {
  const href = recordHref(type, id);
  if (!href) return null;
  return (
    <p className="hint">
      З документа створено запис «{recordLabel(type)}». <Link to={href}>Відкрити</Link>
    </p>
  );
}

/** The phone: the header's actions behind «Ще» (one row is all the header has). */
function MoreMenu({ children }: { children: ReactNode }) {
  const d = useDropdown();
  const id = useId();
  return (
    <div className={s.more} ref={d.root} onKeyDown={d.onKeyDown}>
      <button type="button" className={s.backButton} aria-label="Ще" title="Ще" aria-haspopup="true" aria-expanded={d.open} aria-controls={id} onClick={() => d.setOpen(!d.open)}>
        <Icon name="more" size={20} />
      </button>
      {d.open && (
        <div id={id} className={s.moreMenu}>
          {children}
        </div>
      )}
    </div>
  );
}
