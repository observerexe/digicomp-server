import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Paper } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { OfflineBanner } from '../../components/OfflineBanner';
import { ConfirmButton, ErrorMessage } from '../../components/ui';
import { FieldsPanel } from '../../editor/FieldsPanel';
import { MentionMenu } from '../../editor/MentionMenu';
import { PaperRecordsContext } from '../../editor/records';
import { useFill, useFillSheet } from '../../editor/useFill';
import type { FieldValue, FieldValues } from '../../../../shared/editor-schema/fields';
import '../../../../shared/editor-schema/paper.css';
import '../../editor/format.css';
import { Ribbon } from '../../editor/Ribbon';
import { Ruler } from '../../editor/Ruler';
import { StatusBar, useZoom } from '../../editor/StatusBar';
import { useAutosave, type SaveState } from '../../editor/useAutosave';
import { usePageStats } from '../../editor/usePageStats';
import { errorOf } from '../../errors/messages';
import { formatTime } from '../../lib/format';
import { PAPER_STATUS_LABEL } from '../../lib/labels';
import type { RecordView } from '../../lib/records';
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

  if (paper.isPending) return <PaperLoading />;
  if (paper.isError) {
    return (
      <main id="main" className={s.alone}>
        <BackLink />
        <ErrorMessage text={errorOf(paper.error)} />
      </main>
    );
  }
  return <PaperEditor key={`${paper.data.id}:${paper.dataUpdatedAt}`} paper={paper.data} onReload={() => void paper.refetch()} />;
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

function PaperEditor({ paper, onReload }: { paper: Paper; onReload: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const editable = paper.canEdit && paper.status === 'draft';
  const autosave = useAutosave<PaperChange>(
    (change, revision) => unwrap(api.PATCH('/api/papers/{id}', { params: { path: { id: paper.id } }, body: { revision, ...change } })),
    paper.revision,
  );
  const [title, setTitle] = useState(paper.title);
  const lastTitle = useRef(paper.title);
  const template = paper.template;
  const fill = useFill({ template, values: paper.values as FieldValues, refs: paper.refs as RecordView[], editable });
  const { values } = fill;
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
      autosave.change({ content: e.getJSON() });
    },
  });
  // A value the server refused: its field is shown (the error says what to fix).
  const refused = autosave.state === 'rejected' ? (autosave.rejection?.field ?? null) : null;
  const sheet = useFillSheet(editor, fill, refused);

  const changeValue = (key: string, v: FieldValue | null) => autosave.change({ values: fill.change(key, v) });
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
   * The print page in a new tab, after the changes are saved. The tab opens at
   * once (a tab opened after waiting is blocked as a pop-up), the address comes after.
   */
  const preview = () => {
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.opener = null;
    void autosave.flush().then(() => tab.location.replace(`/api/papers/${paper.id}/print`));
  };

  const saveText = autosave.state === 'saved' ? (autosave.savedAt ? `Збережено о ${formatTime(autosave.savedAt)}` : '') : SAVE_TEXT[autosave.state];

  return (
    <div className={s.editor}>
      <header className={s.top}>
        <Link to="/editor" className={s.backButton} aria-label="Назад" title="Назад до списку">
          <Icon name="back" size={20} />
        </Link>
        <div className={s.heading}>
          <nav aria-label="Шлях" className={s.path}>
            <Link to="/editor">Редактор</Link> / {paper.author.id === user?.id ? 'Мої' : 'Усі'}
          </nav>
          <div className={s.titleRow}>
            {editable ? (
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
            <span className={s.tag}>{PAPER_STATUS_LABEL[paper.status]}</span>
          </div>
          <span className={s.saved} role="status" aria-live="polite">
            {saveText}
          </span>
        </div>
        <span className={s.topActions}>
          <button type="button" className="btn" onClick={preview}>
            Попередній перегляд
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
        </span>
      </header>
      <OfflineBanner />
      {editable && <Ribbon editor={editor} lock={sheet.ribbonLock} />}
      <div className={s.notices}>
        <ErrorMessage text={remove.isError ? errorOf(remove.error) : copy.isError ? errorOf(copy.error) : autosave.state === 'rejected' ? errorOf(autosave.rejection) : null} />
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
        {!editable && <p className="hint">{paper.status === 'draft' ? 'Це чужа чернетка: її можна лише переглядати.' : 'Документ уже не чернетка: текст не змінюється.'}</p>}
      </div>
      <div className={s.work}>
        <main id="main" className={s.desk} tabIndex={-1}>
          <div className={`${s.paperWrap} ${editable ? '' : s.noRuler} ${zoomClass}`}>
            {editable && (
              <div className={s.ruler}>
                <Ruler editor={editor} />
              </div>
            )}
            <EditorContent editor={editor} className={s.sheet} />
          </div>
        </main>
        {template && (
          <PaperRecordsContext value={fill.records}>
            <FieldsPanel
              template={template}
              values={values}
              zones={fill.zones}
              editable={editable}
              active={sheet.shownActive}
              onChange={changeValue}
              onActive={sheet.onActive}
              onJump={(key) => sheet.showField(key, true)}
            />
          </PaperRecordsContext>
        )}
      </div>
      {fill.menu && <MentionMenu menu={fill.menu} keys={fill.menuKeys} />}
      <StatusBar
        stats={stats}
        zoom={zoom}
        onZoom={setZoom}
        hints={editable ? [...(template?.fields.some((f) => f.canFill) ? ['Tab — наступне поле'] : []), '@ — посилання на запис'] : []}
      />
    </div>
  );
}
