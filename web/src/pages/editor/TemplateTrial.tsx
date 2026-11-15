import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { PaperTemplateRef } from '../../api/types';
import { FieldsPanel } from '../../editor/FieldsPanel';
import { MentionMenu } from '../../editor/MentionMenu';
import { PaperRecordsContext } from '../../editor/records';
import { Ribbon } from '../../editor/Ribbon';
import { StatusBar, useZoom } from '../../editor/StatusBar';
import { useFill, useFillSheet } from '../../editor/useFill';
import { usePageStats } from '../../editor/usePageStats';
import { peopleOf, useSheet } from '../../editor/useSheet';
import { useAuth } from '../../auth/AuthProvider';
import s from './editor.module.css';

/**
 * «Документ» in the template constructor: the version filled as a document
 * fills it — the panel «Поля», Tab, pickers, required fields and limits.
 * Nothing is saved and no document is made: values live on this page.
 */
export function TemplateTrial({ template, body }: { template: PaperTemplateRef; body: JSONContent }) {
  const fill = useFill({ template, values: {}, refs: [], editable: true });
  const editor = useEditor({
    extensions: fill.extensions,
    content: body,
    // TipTap's own <style> is blocked by CSP; its rules are in format.css and paper.css.
    injectCSS: false,
    editorProps: { attributes: { class: `paper ${s.page}`, 'aria-label': 'Спроба документа' } },
    onCreate: ({ editor: e }) => fill.syncZones(e.state.doc),
    onBlur: () => fill.closeMenu(),
    onUpdate: ({ editor: e }) => fill.syncZones(e.state.doc),
  });
  const sheet = useFillSheet(editor, fill);
  // As a document of the one trying it would show.
  const { user } = useAuth();
  useSheet(editor, { author: user?.name ?? null, people: peopleOf(template.fields, fill.values, fill.recordTitle) });
  const [zoom, setZoom, zoomClass] = useZoom();
  const stats = usePageStats(editor, zoom);

  return (
    <>
      <Ribbon editor={editor} lock={sheet.ribbonLock} />
      <div className={s.notices}>
        <p className="hint">Спробуйте заповнити шаблон, як це робитиме людина. Нічого не зберігається, документ не створюється.</p>
      </div>
      <div className={s.work}>
        <main id="main" className={s.desk} tabIndex={-1}>
          <div className={`${s.paperWrap} ${s.noRuler} ${zoomClass}`}>
            <EditorContent editor={editor} className={s.sheet} />
          </div>
        </main>
        <PaperRecordsContext value={fill.records}>
          <FieldsPanel
            template={template}
            values={fill.values}
            zones={fill.zones}
            conditions={fill.conditions}
            mode="fill"
            published={false}
            active={sheet.shownActive}
            onChange={fill.change}
            onActive={sheet.onActive}
            onJump={(key) => sheet.showField(key, true)}
          />
        </PaperRecordsContext>
      </div>
      {fill.menu && <MentionMenu menu={fill.menu} keys={fill.menuKeys} />}
      <StatusBar stats={stats} zoom={zoom} onZoom={setZoom} hints={['Tab — наступне поле', '@ — посилання на запис']} />
    </>
  );
}
