import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Paper } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ConfirmButton, ErrorMessage, Skeleton } from '../../components/ui';
import { paperExtensions } from '../../editor/extensions';
import '../../editor/format.css';
import { useAutosave, type SaveState } from '../../editor/useAutosave';
import { errorOf } from '../../errors/messages';
import { formatTime } from '../../lib/format';
import { PAPER_STATUS_LABEL } from '../../lib/labels';
import s from './editor.module.css';

/**
 * One document. Loaded lazily (TipTap is a separate chunk). Loaded once:
 * the editor keeps its own state, the server only receives changes.
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

  if (paper.isPending) return <Skeleton height={480} />;
  if (paper.isError) {
    return (
      <>
        <BackLink />
        <ErrorMessage text={errorOf(paper.error)} />
      </>
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
  conflict: 'Не збережено',
};

const TITLE_MAX = 200;

function PaperEditor({ paper, onReload }: { paper: Paper; onReload: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editable = paper.canEdit && paper.status === 'draft';
  const autosave = useAutosave(paper.id, paper.revision);
  const [title, setTitle] = useState(paper.title);
  const lastTitle = useRef(paper.title);
  const extensions = useMemo(() => paperExtensions(), []);
  const editor = useEditor({
    extensions,
    content: paper.content,
    editable,
    // TipTap's own <style> is blocked by CSP; its rules are in format.css.
    injectCSS: false,
    editorProps: { attributes: { class: `paper ${s.page}`, 'aria-label': 'Текст документа' } },
    onUpdate: ({ editor: e }) => autosave.change({ content: e.getJSON() }),
  });

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
      return unwrap(api.POST('/api/papers', { body: { title: name, content: editor.getJSON() } }));
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

  const saveText = autosave.state === 'saved' ? (autosave.savedAt ? `Збережено о ${formatTime(autosave.savedAt)}` : '') : SAVE_TEXT[autosave.state];

  return (
    <div className={s.editor}>
      <header className={s.top}>
        <BackLink />
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
        <span className={s.saved} role="status" aria-live="polite">
          {saveText}
        </span>
        {editable && (
          <span className={s.topActions}>
            <ConfirmButton label="Видалити чернетку" question="Видалити чернетку назавжди?" confirmLabel="Видалити" danger disabled={remove.isPending} onConfirm={() => remove.mutate()} />
          </span>
        )}
      </header>
      <ErrorMessage text={remove.isError ? errorOf(remove.error) : copy.isError ? errorOf(copy.error) : null} />
      {autosave.state === 'conflict' && (
        <div className={s.conflict} role="alert">
          <p>
            Документ змінили в іншому вікні чи іншою людиною, тому ваші останні зміни не збережено. Відкрийте останню версію (ваші зміни зникнуть) або збережіть свій
            текст окремою чернеткою.
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
      {!editable && (
        <p className="hint">{paper.status === 'draft' ? 'Це чужа чернетка: її можна лише переглядати.' : 'Документ уже не чернетка: текст не змінюється.'}</p>
      )}
      <div className={s.desk}>
        <EditorContent editor={editor} className={s.sheet} />
      </div>
    </div>
  );
}
