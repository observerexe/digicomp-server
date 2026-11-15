import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Paper, PaperTemplateRef } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { OfflineBanner } from '../../components/OfflineBanner';
import { ConfirmButton, ErrorMessage } from '../../components/ui';
import { paperExtensions } from '../../editor/extensions';
import { fieldPosition, setFieldsLook, zoneAtSelection, zoneTexts, type FieldsLook } from '../../editor/fields';
import { fieldControlId, FieldsPanel, isFilled } from '../../editor/FieldsPanel';
import { valueText, type FieldValue, type FieldValues } from '../../../../shared/editor-schema/fields';
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

/** What the sheet shows for each field and zone now. */
function lookOf(template: PaperTemplateRef, values: FieldValues, zones: Record<string, string>, active: string | null): FieldsLook {
  const look: FieldsLook = { fields: {}, zones: {}, active };
  for (const f of template.fields) {
    const filled = isFilled(f, values, zones);
    if (f.type === 'richtext') {
      look.zones[f.key] = { label: f.label, missing: f.required && !filled };
      continue;
    }
    const v = values[f.key];
    look.fields[f.key] = {
      text: v !== undefined ? valueText(f.type, v, f.options) : f.label,
      state: filled ? 'filled' : f.fill === 'staff' && !f.canFill ? 'staff' : f.required ? 'missing' : 'empty',
    };
  }
  return look;
}

function PaperEditor({ paper, onReload }: { paper: Paper; onReload: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const editable = paper.canEdit && paper.status === 'draft';
  const autosave = useAutosave(paper.id, paper.revision);
  const [title, setTitle] = useState(paper.title);
  const lastTitle = useRef(paper.title);
  const template = paper.template;
  const [values, setValues] = useState<FieldValues>(paper.values as FieldValues);
  const [zones, setZones] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  // A click on a field on the sheet opens its control in the panel.
  const openField = useRef((key: string) => {
    setActive(key);
    document.getElementById(fieldControlId(key))?.focus();
  });
  const extensions = useMemo(
    () =>
      paperExtensions(
        template
          ? {
              plain: new Set(template.fields.filter((f) => f.plain).map((f) => f.key)),
              locked: new Set(template.fields.filter((f) => f.type === 'richtext' && !f.canFill).map((f) => f.key)),
              onFieldClick: (key) => openField.current(key),
            }
          : undefined,
      ),
    [template],
  );
  const syncZones = (texts: Record<string, string>) => setZones((prev) => (JSON.stringify(prev) === JSON.stringify(texts) ? prev : texts));
  const editor = useEditor({
    extensions,
    content: paper.content,
    editable,
    // TipTap's own <style> is blocked by CSP; its rules are in format.css and paper.css.
    injectCSS: false,
    editorProps: { attributes: { class: `paper ${s.page}`, 'aria-label': 'Текст документа' } },
    onCreate: ({ editor: e }) => syncZones(zoneTexts(e.state.doc)),
    onUpdate: ({ editor: e }) => {
      syncZones(zoneTexts(e.state.doc));
      autosave.change({ content: e.getJSON() });
    },
  });
  const zone = useEditorState({ editor, selector: ({ editor: e }) => (template ? zoneAtSelection(e.state) : null) });
  // A value the server refused: its field is shown (the error says what to fix).
  const refused = autosave.state === 'rejected' ? (autosave.rejection?.field ?? null) : null;
  const shownActive = zone ?? refused ?? active;
  useEffect(() => {
    if (template) setFieldsLook(editor, lookOf(template, values, zones, shownActive));
  }, [editor, template, values, zones, shownActive]);

  const changeValue = (key: string, v: FieldValue | null) => {
    const next = { ...values };
    if (v === null) delete next[key];
    else next[key] = v;
    setValues(next);
    autosave.change({ values: next });
  };
  /** Bring a field into view on the sheet; a zone — put the cursor in it. */
  const showField = (key: string, focusZone: boolean) => {
    const pos = fieldPosition(editor, key);
    if (pos === null) return;
    const zoneNode = editor.state.doc.nodeAt(pos)?.type.name === 'fieldZone';
    if (zoneNode && focusZone)
      editor
        .chain()
        .focus()
        .setTextSelection(pos + 2)
        .scrollIntoView()
        .run();
    else (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  };
  const ribbonLock =
    !template || !editable
      ? null
      : zone === null
        ? 'Тут текст шаблону: змінюються лише поля в панелі «Поля» і вільні зони в рамках.'
        : template.fields.find((f) => f.key === zone)?.plain
          ? 'Ця зона — лише текст, без форматування.'
          : null;
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
      {editable && <Ribbon editor={editor} lock={ribbonLock} />}
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
          <FieldsPanel
            template={template}
            values={values}
            zones={zones}
            editable={editable}
            active={shownActive}
            onChange={changeValue}
            onActive={(key) => {
              setActive(key);
              if (key) showField(key, false);
            }}
            onJump={(key) => showField(key, true)}
          />
        )}
      </div>
      <StatusBar stats={stats} zoom={zoom} onZoom={setZoom} />
    </div>
  );
}
