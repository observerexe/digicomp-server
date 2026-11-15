import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { RecordSchema, Template, TemplateVersion } from '../../api/types';
import { Icon } from '../../components/Icon';
import { OfflineBanner } from '../../components/OfflineBanner';
import { ErrorMessage } from '../../components/ui';
import { BlockMenu } from '../../editor/BlockMenu';
import { BLOCKS, fieldBlockOf } from '../../editor/blocks';
import {
  builderExtension,
  cursorAtEnd,
  placeBlock,
  removeBlock,
  removeField,
  renameField,
  selectionOf,
  selectionRange,
  setBuilderLook,
  type BlockMenuState,
  type BuilderLook,
} from '../../editor/builder';
import { BuilderPanel, type BuilderTab } from '../../editor/BuilderPanel';
import { paperExtensions } from '../../editor/extensions';
import { fieldPosition } from '../../editor/fields';
import { Ribbon } from '../../editor/Ribbon';
import { Ruler } from '../../editor/Ruler';
import { StatusBar, useZoom } from '../../editor/StatusBar';
import { defsOf, fieldsOf, fieldTag, keysOf, newField, type FieldDef } from '../../editor/template';
import { useAutosave, type SaveState } from '../../editor/useAutosave';
import { usePageStats } from '../../editor/usePageStats';
import { errorOf } from '../../errors/messages';
import { recordsKey } from '../../lib/fields';
import { formatTime } from '../../lib/format';
import { useMediaQuery } from '../../lib/useMediaQuery';
import type { PaperNode } from '../../../../shared/editor-schema';
import '../../../../shared/editor-schema/paper.css';
import '../../editor/format.css';
import s from './editor.module.css';
import { PaperLoading } from './PaperLoading';

/** The constructor needs room for the sheet and the panel. */
const WIDE = '(min-width: 900px)';
const BACK = '/editor?tab=templates';

/**
 * The template constructor: the draft version of a template (made from the
 * current one when there is none), in the whole window. Loaded lazily with TipTap.
 */
export function TemplatePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const wide = useMediaQuery(WIDE);
  const template = useQuery({
    queryKey: ['paper-templates', 'one', id],
    queryFn: () => unwrap(api.GET('/api/papers/templates/{id}', { params: { path: { id } } })),
    enabled: wide,
  });
  // The draft: the server returns the one there is, or makes it. Our own saves change its revision: no refetch.
  const draft = useQuery({
    queryKey: ['paper-templates', 'draft', id],
    queryFn: () => unwrap(api.POST('/api/papers/templates/{id}/versions', { params: { path: { id } } })),
    enabled: wide,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const target = template.data?.target ?? null;
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
  if (template.isPending || draft.isPending) return <PaperLoading />;
  if (template.isError || draft.isError) {
    return (
      <main id="main" className={s.alone}>
        <BackLink />
        <ErrorMessage text={errorOf(template.error ?? draft.error)} />
      </main>
    );
  }
  return (
    <TemplateBuilder key={`${draft.data.number}:${draft.dataUpdatedAt}`} template={template.data} version={draft.data} schema={schema.data} onReload={() => void draft.refetch()} />
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

function TemplateBuilder({ template, version, schema, onReload }: { template: Template; version: TemplateVersion; schema: RecordSchema | undefined; onReload: () => void }) {
  const autosave = useAutosave<VersionChange>(
    (change, revision) => unwrap(api.PATCH('/api/papers/templates/{id}/versions/{v}', { params: { path: { id: template.id, v: version.number } }, body: { revision, ...change } })),
    version.revision,
  );
  // Settings of every field met here, those taken off the sheet too: «Скасувати» brings a field back with them.
  const [defs, setDefs] = useState(() => defsOf(version.fields, version.body as PaperNode));
  const defsRef = useRef(defs);
  const [keys, setKeys] = useState<string[]>([]);
  const fields = useMemo(() => fieldsOf(defs, keys), [defs, keys]);
  const [tab, setTab] = useState<BuilderTab>('blocks');
  const [preview, setPreview] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [menu, setMenu] = useState<BlockMenuState | null>(null);
  const menuKeys = useRef<(e: KeyboardEvent) => boolean>(() => false);

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
  const syncKeys = (k: string[]) => setKeys((prev) => (prev.join() === k.join() ? prev : k));
  const editor = useEditor({
    extensions,
    content: version.body,
    // TipTap's own <style> is blocked by CSP; its rules are in format.css and paper.css.
    injectCSS: false,
    editorProps: { attributes: { class: `paper ${s.page}`, 'aria-label': 'Аркуш шаблону' } },
    onCreate: ({ editor: e }) => syncKeys(keysOf(e.state.doc)),
    onBlur: () => setMenu(null),
    onUpdate: ({ editor: e }) => {
      const k = keysOf(e.state.doc);
      syncKeys(k);
      autosave.change({ body: e.getJSON(), fields: fieldsOf(defsRef.current, k) });
    },
  });
  const selected = useEditorState({ editor, selector: ({ editor: e }) => selectionOf(e.state) });

  actions.current = {
    place: (key, range) => {
      const block = BLOCKS.find((b) => b.key === key);
      if (!block) return;
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
    if (picked) setTab('props');
  }, [picked]);

  // What the sheet shows for each field.
  useEffect(() => {
    const look: BuilderLook = { preview, fields: {} };
    for (const f of defs.values()) {
      const group = fieldBlockOf(f.type)?.group === 'data' ? 'data' : 'field';
      look.fields[f.key] = {
        text: preview ? f.label : showKeys ? `{${f.key}}` : `{${f.label}}`,
        state: preview ? (f.required ? 'missing' : 'empty') : group,
        tag: fieldTag(f, schema),
        group,
      };
    }
    setBuilderLook(editor, look);
  }, [editor, defs, preview, showKeys, schema]);
  useEffect(() => {
    editor.setEditable(!preview, false);
  }, [editor, preview]);

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

  const [zoom, setZoom, zoomClass] = useZoom();
  const stats = usePageStats(editor, zoom);
  const saveText = autosave.state === 'saved' ? (autosave.savedAt ? `Збережено о ${formatTime(autosave.savedAt)}` : '') : SAVE_TEXT[autosave.state];

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
            <span className={`${s.tag} ${s.tagDraft}`}>v{version.number} чернетка</span>
          </div>
          <span className={s.saved} role="status" aria-live="polite">
            {saveText}
          </span>
        </div>
        <div className={s.segmented} role="group" aria-label="Режим">
          <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
            Документ
          </button>
          <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
            Конструктор шаблону
          </button>
        </div>
      </header>
      <OfflineBanner />
      {!preview && (
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
        <ErrorMessage text={autosave.state === 'rejected' ? errorOf(autosave.rejection) : null} />
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
        {preview && <p className="hint">Так аркуш побачить людина в документі. Щоб змінити шаблон, перейдіть у «Конструктор шаблону».</p>}
      </div>
      <div className={s.work}>
        <main id="main" className={s.desk} tabIndex={-1}>
          <div className={`${s.paperWrap} ${preview ? s.noRuler : ''} ${zoomClass}`}>
            {!preview && (
              <div className={s.ruler}>
                <Ruler editor={editor} />
              </div>
            )}
            <EditorContent editor={editor} className={s.sheet} />
          </div>
        </main>
        {!preview && (
          <BuilderPanel
            tab={tab}
            onTab={setTab}
            selected={selected}
            defs={defs}
            fields={fields}
            kind={template.kind}
            schema={schema}
            onPick={(block) => actions.current.place(block, selectionRange(editor.state))}
            onChange={changeField}
            onRename={rename}
            onRemoveField={(key) => removeField(editor, key)}
            onRemoveBlock={(index) => removeBlock(editor, index)}
            onSelectField={selectField}
          />
        )}
      </div>
      {menu && <BlockMenu menu={menu} keys={menuKeys} />}
      <StatusBar stats={stats} zoom={zoom} onZoom={setZoom} hints={preview ? [] : ['/ — вставити блок']} />
    </div>
  );
}
