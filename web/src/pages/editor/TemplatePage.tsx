import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { PaperTemplateRef, RecordSchema, Template, TemplateVersion } from '../../api/types';
import { Icon } from '../../components/Icon';
import { OfflineBanner } from '../../components/OfflineBanner';
import { ConfirmButton, ErrorMessage } from '../../components/ui';
import { BlockMenu } from '../../editor/BlockMenu';
import { fieldBlockOf, type Palette } from '../../editor/blocks';
import { isAutoBinding, paletteOf } from '../../editor/blocks/schema';
import {
  builderExtension,
  cursorAtEnd,
  placeBlock,
  removeBlock,
  removeField,
  renameField,
  selectionOf,
  selectionRange,
  setBlockAttrs,
  setBuilderLook,
  type BlockMenuState,
  type BuilderLook,
} from '../../editor/builder';
import { BuilderPanel, isUsed, type BuilderTab } from '../../editor/BuilderPanel';
import { paperExtensions } from '../../editor/extensions';
import { useSheet } from '../../editor/useSheet';
import { fieldPosition } from '../../editor/fields';
import { Ribbon } from '../../editor/Ribbon';
import { Ruler } from '../../editor/Ruler';
import { StatusBar, useZoom } from '../../editor/StatusBar';
import { columnsOf, defsOf, fieldsOf, fieldTag, keysOf, newField, type FieldDef } from '../../editor/template';
import { useAutosave, type SaveState } from '../../editor/useAutosave';
import { usePageStats } from '../../editor/usePageStats';
import { errorOf } from '../../errors/messages';
import { recordsKey } from '../../lib/fields';
import { formatTime, plural } from '../../lib/format';
import { useMediaQuery } from '../../lib/useMediaQuery';
import type { PaperNode } from '../../../../shared/editor-schema';
import '../../../../shared/editor-schema/paper.css';
import '../../editor/format.css';
import s from './editor.module.css';
import { PaperLoading } from './PaperLoading';
import { TemplateSettings } from './TemplateSettings';
import { TemplateTrial } from './TemplateTrial';

/** The constructor needs room for the sheet and the panel. */
const WIDE = '(min-width: 900px)';
const BACK = '/editor?tab=templates';

/**
 * The template constructor, in the whole window: the draft version of a
 * template; without a draft — the current version, read only, until
 * «Змінити» makes a draft from it. Loaded lazily with TipTap.
 */
export function TemplatePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wide = useMediaQuery(WIDE);
  // «Змінити» on a published version: the draft is wanted before the template knows of it.
  const [editing, setEditing] = useState(false);
  const templateKey = ['paper-templates', 'one', id];
  const template = useQuery({
    queryKey: templateKey,
    queryFn: () => unwrap(api.GET('/api/papers/templates/{id}', { params: { path: { id } } })),
    enabled: wide,
  });
  const t = template.data;
  // A draft if there is one (or nothing is published: the server makes v1), otherwise the current version.
  const shown = !t ? null : editing || t.draftVersion !== null || t.currentVersion === null ? 'draft' : t.currentVersion;
  // Our own saves change the draft's revision: no refetch.
  const version = useQuery({
    queryKey: ['paper-templates', 'version', id, shown],
    queryFn: () =>
      unwrap(
        shown === 'draft'
          ? api.POST('/api/papers/templates/{id}/versions', { params: { path: { id } } })
          : api.GET('/api/papers/templates/{id}/versions/{v}', { params: { path: { id, v: shown! } } }),
      ),
    enabled: shown !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const target = t?.target ?? null;
  const schema = useQuery({
    queryKey: [...recordsKey(target ?? ''), 'schema'],
    queryFn: () => unwrap(api.GET('/api/records/{type}/schema', { params: { path: { type: target! } } })),
    enabled: !!target,
  });
  // The list shows the draft: refresh it when leaving.
  useEffect(() => () => void qc.invalidateQueries({ queryKey: ['paper-templates', 'list'] }), [qc]);

  if (!wide) {
    return (
      <main id="main" className={s.alone}>
        <BackLink />
        <p>Конструктор шаблону відкривається на екрані від 900 px: розгорніть вікно або відкрийте його на комп’ютері.</p>
      </main>
    );
  }
  if (template.isPending || (shown !== null && version.isPending)) return <PaperLoading />;
  if (template.isError || version.isError) {
    return (
      <main id="main" className={s.alone}>
        <BackLink />
        <ErrorMessage text={errorOf(template.error ?? version.error)} />
      </main>
    );
  }
  const reloadTemplate = () => void qc.invalidateQueries({ queryKey: templateKey });
  return (
    <TemplateBuilder
      key={`${version.data!.number}:${version.data!.publishedAt ?? 'draft'}:${version.dataUpdatedAt}`}
      template={template.data}
      version={version.data!}
      schema={schema.data}
      onReload={() => void version.refetch()}
      onTemplate={(next) => qc.setQueryData(templateKey, next)}
      onPublished={(next) => {
        setEditing(false);
        qc.setQueryData(templateKey, next);
      }}
      onEdit={() => {
        setEditing(true);
        reloadTemplate();
      }}
      onDiscarded={() => {
        setEditing(false);
        reloadTemplate();
      }}
      onDeleted={() => void navigate(BACK)}
    />
  );
}

function BackLink() {
  return (
    <Link to={BACK} className={s.back}>
      <Icon name="back" size={20} />
      Шаблони
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

type VersionChange = { body: JSONContent; fields: FieldDef[] };

type BuilderProps = {
  template: Template;
  /** The draft, or the current version (read only). */
  version: TemplateVersion;
  schema: RecordSchema | undefined;
  onReload: () => void;
  /** The server's template after a change of it. */
  onTemplate: (t: Template) => void;
  onPublished: (t: Template) => void;
  /** «Змінити»: a draft of a new version. */
  onEdit: () => void;
  onDiscarded: () => void;
  onDeleted: () => void;
};

function TemplateBuilder({ template, version, schema, onReload, onTemplate, onPublished, onEdit, onDiscarded, onDeleted }: BuilderProps) {
  const readOnly = version.publishedAt !== null;
  const autosave = useAutosave<VersionChange>(
    (change, revision) => unwrap(api.PATCH('/api/papers/templates/{id}/versions/{v}', { params: { path: { id: template.id, v: version.number } }, body: { revision, ...change } })),
    version.revision,
  );
  // Settings of every field met here, those taken off the sheet too: «Скасувати» brings a field back with them.
  const [defs, setDefs] = useState(() => defsOf(version.fields, version.body as PaperNode));
  const defsRef = useRef(defs);
  const [keys, setKeys] = useState<string[]>([]);
  const fields = useMemo(() => fieldsOf(defs, keys), [defs, keys]);
  const tabs: BuilderTab[] = readOnly ? ['template'] : ['blocks', 'props', 'template'];
  const [tab, setTab] = useState<BuilderTab>(tabs[0]!);
  const [showKeys, setShowKeys] = useState(false);
  const [menu, setMenu] = useState<BlockMenuState | null>(null);
  const menuKeys = useRef<(e: KeyboardEvent) => boolean>(() => false);
  // «Документ»: the version tried as a document fills it.
  const [trial, setTrial] = useState<{ template: PaperTemplateRef; body: JSONContent } | null>(null);

  // The palette: the record's fields first; those bound on the sheet are not offered again.
  const palette = useMemo(() => paletteOf(template.kind, schema), [template.kind, schema]);
  const used = useMemo(() => new Set(fields.flatMap((f) => (f.binding ? [f.binding] : []))), [fields]);
  const menuPalette: Palette = useMemo(() => ({ ...palette, blocks: palette.blocks.filter((b) => !isUsed(b, used)) }), [palette, used]);

  const changeDefs = (next: Map<string, FieldDef>) => {
    defsRef.current = next;
    setDefs(next);
  };

  // The editor's callbacks read the latest page through this ref.
  const actions = useRef({ place: (_block: string, _range: { from: number; to: number }) => {}, end: () => {} });
  const extensions = useMemo(
    () => [
      ...paperExtensions(),
      builderExtension({
        known: () => new Set(defsRef.current.keys()),
        onPlace: (block, range) => actions.current.place(block, range),
        onEnd: () => actions.current.end(),
        menu: { show: setMenu, key: (e) => menuKeys.current(e) },
      }),
    ],
    [],
  );
  // Columns of «Повторювані рядки»: their «Властивості» follow the block.
  const [columns, setColumns] = useState<ReadonlyMap<string, string>>(new Map());
  const syncKeys = (k: string[], doc: Parameters<typeof keysOf>[0]) => {
    setKeys((prev) => (prev.join() === k.join() ? prev : k));
    const c = columnsOf(doc);
    setColumns((prev) => (JSON.stringify([...prev]) === JSON.stringify([...c]) ? prev : c));
  };
  const editor = useEditor({
    extensions,
    content: version.body,
    editable: !readOnly,
    // TipTap's own <style> is blocked by CSP; its rules are in format.css and paper.css.
    injectCSS: false,
    editorProps: { attributes: { class: `paper ${s.page}`, 'aria-label': 'Аркуш шаблону' } },
    onCreate: ({ editor: e }) => syncKeys(keysOf(e.state.doc), e.state.doc),
    onBlur: () => setMenu(null),
    onUpdate: ({ editor: e }) => {
      const k = keysOf(e.state.doc);
      syncKeys(k, e.state.doc);
      autosave.change({ body: e.getJSON(), fields: fieldsOf(defsRef.current, k) });
    },
  });
  const selected = useEditorState({ editor, selector: ({ editor: e }) => selectionOf(e.state) });

  actions.current = {
    place: (key, range) => {
      const block = palette.blocks.find((b) => b.key === key);
      if (!block || isUsed(block, used)) return;
      let fieldKey: string | null = null;
      if (block.kind === 'field') {
        const f = newField(block, new Set(defsRef.current.keys()));
        fieldKey = f.key;
        changeDefs(new Map(defsRef.current).set(f.key, f));
      }
      if (placeBlock(editor, block, fieldKey, range) && fieldKey) setTab('props');
    },
    end: () => cursorAtEnd(editor),
  };

  // A field picked on the sheet — its properties.
  const picked = selected?.kind === 'field' && selected.picked ? selected.key : null;
  useEffect(() => {
    if (picked && !readOnly) setTab('props');
  }, [picked, readOnly]);

  // What the sheet shows for each field.
  useEffect(() => {
    const look: BuilderLook = { editable: !readOnly, fields: {} };
    for (const f of defs.values()) {
      const auto = isAutoBinding(
        template.kind,
        schema?.fields.find((x) => x.key === f.binding),
      );
      const group = auto ? 'auto' : fieldBlockOf(f.type)?.group === 'data' ? 'data' : 'field';
      look.fields[f.key] = { text: showKeys ? `{${f.key}}` : `{${f.label}}`, state: group, tag: fieldTag(f, schema), group };
    }
    // A conditional block: its field and the choice by their names (a choice of the record's field — its label).
    look.condition = (field, value) => {
      const f = defs.get(field);
      const choice = schema?.fields.find((x) => x.key === f?.binding)?.options?.find((o) => o.key === value)?.label ?? value;
      return `«${f ? (showKeys ? f.key : f.label) : field}» = «${choice}»`;
    };
    setBuilderLook(editor, look);
  }, [editor, defs, showKeys, schema, readOnly, template.kind]);

  // The header and «Затверджую» from «Реквізити»; auto values and who signs — by their names.
  useSheet(editor, { builder: true, people: Object.fromEntries(fields.filter((f) => f.type === 'ref:user').map((f) => [f.key, `{${showKeys ? f.key : f.label}}`])) });

  const saveFields = (next: Map<string, FieldDef>) => {
    changeDefs(next);
    autosave.change({ fields: fieldsOf(next, keysOf(editor.state.doc)) });
  };
  const changeField = (f: FieldDef) => saveFields(new Map(defsRef.current).set(f.key, f));
  const rename = (from: string, to: string) => {
    const f = defsRef.current.get(from);
    if (!f) return;
    // The old key keeps its settings: «Повторити» may bring it back.
    changeDefs(new Map(defsRef.current).set(to, { ...f, key: to }));
    renameField(editor, from, to);
  };
  const selectField = (key: string) => {
    const pos = fieldPosition(editor, key);
    if (pos === null) return;
    const node = editor.state.doc.nodeAt(pos);
    const chain = editor.chain().focus();
    (node?.type.name === 'field' ? chain.setNodeSelection(pos) : chain.setTextSelection(pos + 2)).scrollIntoView().run();
  };

  /** Everything on the server first: the server reads the saved version. */
  const flushed = async () => readOnly || (await autosave.flush());
  const tryIt = useMutation({
    mutationFn: async () => {
      if (!(await flushed())) return null;
      const ref = await unwrap(api.GET('/api/papers/templates/{id}/versions/{v}/fields', { params: { path: { id: template.id, v: version.number } } }));
      return { template: ref, body: editor.getJSON() };
    },
    onSuccess: (t) => t && setTrial(t),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!(await flushed())) return null;
      return unwrap(api.POST('/api/papers/templates/{id}/versions/{v}/publish', { params: { path: { id: template.id, v: version.number } } }));
    },
    onSuccess: (t) => {
      if (!t) return;
      autosave.cancel();
      onPublished(t);
    },
    onError: (e) => {
      // The field the server refused: selected on the sheet, its properties open.
      if (e instanceof ApiError && e.field && defsRef.current.has(e.field)) {
        setTab('props');
        selectField(e.field);
      }
    },
  });

  const [zoom, setZoom, zoomClass] = useZoom();
  const stats = usePageStats(editor, zoom);
  const saveText = readOnly ? '' : autosave.state === 'saved' ? (autosave.savedAt ? `Збережено о ${formatTime(autosave.savedAt)}` : '') : SAVE_TEXT[autosave.state];
  const current = template.versions.find((v) => v.number === template.currentVersion);
  const kept =
    !readOnly && current?.documents ? `${current.documents} ${plural(current.documents, ['документ', 'документи', 'документів'])} на v${current.number} не зміняться` : '';
  const publishError = publish.error instanceof ApiError && publish.error.binding ? bindingMissing(publish.error.binding, schema) : publish.error ? errorOf(publish.error) : null;

  return (
    <div className={s.editor}>
      <header className={s.top}>
        <Link to={BACK} className={s.backButton} aria-label="Назад" title="Назад до шаблонів">
          <Icon name="back" size={20} />
        </Link>
        <div className={s.heading}>
          <nav aria-label="Шлях" className={s.path}>
            <Link to="/editor">Редактор</Link> / <Link to={BACK}>Шаблони</Link>
          </nav>
          <div className={s.titleRow}>
            <h1 className={s.titleText}>{template.title}</h1>
            {template.currentVersion !== null && <span className={`${s.tag} ${s.tagPublished}`}>v{template.currentVersion} опубліковано</span>}
            {!readOnly && <span className={`${s.tag} ${s.tagDraft}`}>v{version.number} чернетка</span>}
            {template.needsUpdate && <span className={s.tag}>Потребує оновлення</span>}
            {template.archived && <span className={s.tag}>В архіві</span>}
          </div>
          <span className={s.saved} role="status" aria-live="polite">
            {[saveText, kept].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className={s.segmented} role="group" aria-label="Режим">
          <button type="button" aria-pressed={!!trial} disabled={tryIt.isPending} onClick={() => !trial && tryIt.mutate()}>
            Документ
          </button>
          <button type="button" aria-pressed={!trial} onClick={() => setTrial(null)}>
            Конструктор шаблону
          </button>
        </div>
        <span className={s.topActions}>
          {readOnly ? (
            <button type="button" className="btn btn-primary" onClick={onEdit}>
              Змінити
            </button>
          ) : (
            <ConfirmButton
              label={`Опублікувати v${version.number}`}
              question={`Нові документи створюватимуться з v${version.number}. Опублікувати?`}
              confirmLabel="Опублікувати"
              primary
              disabled={publish.isPending}
              onConfirm={() => publish.mutate()}
            />
          )}
        </span>
      </header>
      <OfflineBanner />
      {trial && <TemplateTrial template={trial.template} body={trial.body} />}
      <div className={trial ? s.gone : s.contents}>
        {!readOnly && (
          <Ribbon
            editor={editor}
            extra={
              <button type="button" className={s.ribbonToggle} aria-pressed={showKeys} onClick={() => setShowKeys(!showKeys)}>
                Показати ключі полів
              </button>
            }
          />
        )}
        <div className={s.notices}>
          <ErrorMessage text={publishError ?? (tryIt.isError ? errorOf(tryIt.error) : autosave.state === 'rejected' ? errorOf(autosave.rejection) : null)} />
          {autosave.state === 'conflict' && (
            <div className={s.conflict} role="alert">
              <p>Шаблон змінили в іншому вікні чи іншою людиною, тому ваші останні зміни не збережено. Відкрийте останню версію чернетки: ваші зміни зникнуть.</p>
              <div className={s.conflictActions}>
                <button type="button" className="btn btn-primary" onClick={onReload}>
                  Відкрити останню версію
                </button>
              </div>
            </div>
          )}
          {template.needsUpdate && (
            <p className="hint">Поля запису змінилися, і поточна версія потребує оновлення: нові документи з неї не створюються. Виправте поля й опублікуйте нову версію.</p>
          )}
          {readOnly && (
            <p className="hint">Це опублікована версія v{version.number}: вона не змінюється. Щоб змінити шаблон, натисніть «Змінити» — з’явиться чернетка нової версії.</p>
          )}
        </div>
        <div className={s.work}>
          {/* While «Документ» is tried, its sheet is the page's main part. */}
          <main id={trial ? undefined : 'main'} className={s.desk} tabIndex={-1}>
            <div className={`${s.paperWrap} ${readOnly ? s.noRuler : ''} ${zoomClass}`}>
              {!readOnly && (
                <div className={s.ruler}>
                  <Ruler editor={editor} />
                </div>
              )}
              <EditorContent editor={editor} className={s.sheet} />
            </div>
          </main>
          <BuilderPanel
            tab={tab}
            tabs={tabs}
            onTab={setTab}
            palette={palette}
            used={used}
            settings={<TemplateSettings template={template} schema={schema} onChange={onTemplate} stopSaving={autosave.cancel} onDiscarded={onDiscarded} onDeleted={onDeleted} />}
            selected={selected}
            defs={defs}
            fields={fields}
            columns={columns}
            kind={template.kind}
            schema={schema}
            onPick={(block) => actions.current.place(block, selectionRange(editor.state))}
            onChange={changeField}
            onRename={rename}
            onRemoveField={(key) => removeField(editor, key)}
            onRemoveBlock={(index) => removeBlock(editor, index)}
            onBlockAttrs={(index, attrs) => setBlockAttrs(editor, index, attrs)}
            onSelectField={selectField}
          />
        </div>
        {menu && <BlockMenu menu={menu} keys={menuKeys} palette={menuPalette} />}
        <StatusBar stats={stats} zoom={zoom} onZoom={setZoom} hints={readOnly ? [] : ['/ — вставити блок']} />
      </div>
    </div>
  );
}

/** A field the record needs that no field of the template is bound to. */
function bindingMissing(key: string, schema: RecordSchema | undefined): string {
  const label = schema?.fields.find((f) => f.key === key)?.label ?? key;
  return `Запис не створиться без поля «${label}»: додайте його з групи «Поля запису» на вкладці «Блоки» або прив’яжіть до нього поле шаблону.`;
}
