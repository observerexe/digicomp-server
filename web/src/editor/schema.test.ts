import { Editor, getSchema } from '@tiptap/core';
import type { ContentMatch, NodeType } from '@tiptap/pm/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContent, formatClasses, MARKS, NODES } from '../../../shared/editor-schema';
import { paperExtensions } from './extensions';

const schema = getSchema(paperExtensions());

/** Every node type a node may hold, from its content expression. */
function childTypes(type: NodeType): string[] {
  const seen = new Set<ContentMatch>();
  const types = new Set<string>();
  const walk = (m: ContentMatch) => {
    if (seen.has(m)) return;
    seen.add(m);
    for (let i = 0; i < m.edgeCount; i++) {
      const edge = m.edge(i);
      types.add(edge.type.name);
      walk(edge.next);
    }
  };
  walk(type.contentMatch);
  return [...types].sort();
}

const defaults = (attrs: Record<string, { default: unknown }>) => Object.fromEntries(Object.entries(attrs).map(([k, a]) => [k, a.default]));

describe('Схема редактора = спільний опис (shared/editor-schema)', () => {
  it('ті самі вузли й позначки', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(Object.keys(NODES).sort());
    expect(Object.keys(schema.marks).sort()).toEqual(Object.keys(MARKS).sort());
  });

  it.each(Object.keys(NODES))('вузол %s: атрибути, типові значення й діти', (name) => {
    const type = schema.nodes[name]!;
    const rule = NODES[name]!;
    const attrs = Object.fromEntries(Object.entries(type.spec.attrs ?? {}).map(([k, a]) => [k, a.default]));
    expect(attrs).toEqual(defaults(rule.attrs));
    expect(childTypes(type)).toEqual([...(rule.children ?? [])].sort());
  });

  it.each(Object.keys(MARKS))('позначка %s: атрибути й типові значення', (name) => {
    const attrs = Object.fromEntries(Object.entries(schema.marks[name]!.spec.attrs ?? {}).map(([k, a]) => [k, a.default]));
    expect(attrs).toEqual(defaults(MARKS[name]!.attrs));
  });
});

describe('Форматування класами', () => {
  const editor = () => new Editor({ extensions: paperExtensions(), injectCSS: false, content: '<p>Текст документа</p>' });

  it('документ з усім форматуванням проходить перевірку сервера, у HTML немає style', () => {
    const e = editor();
    e.chain().selectAll().setFontSize(18).setTextColor('blue').setFont('sans').toggleBold().setAlign('center').indent().indent().run();
    e.chain().focus('end').setPageBreak().run();
    e.chain().focus('end').insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    e.chain().focus('end').toggleOrderedList().run();
    const json = e.getJSON();
    expect(checkContent(json)).toBe(true);
    const html = e.getHTML();
    expect(html).not.toContain('style=');
    expect(html).toContain('class="ta-center in-2"');
    expect(html).toMatch(/<span class="fs-18 tc-blue ff-sans">/);
    expect(html).toContain('class="page-break"');
    e.destroy();
  });

  it('скасування форматування прибирає позначку textStyle', () => {
    const e = editor();
    e.chain().selectAll().setFontSize(18).run();
    e.chain().selectAll().setFontSize(null).run();
    expect(JSON.stringify(e.getJSON())).not.toContain('textStyle');
    e.destroy();
  });

  it('відступ не виходить за межі 0…6', () => {
    const e = editor();
    e.chain().selectAll().outdent().run();
    expect(e.getJSON().content?.[0]?.attrs?.indent).toBe(0);
    for (let i = 0; i < 10; i++) e.chain().selectAll().indent().run();
    expect(e.getJSON().content?.[0]?.attrs?.indent).toBe(6);
    e.destroy();
  });

  it('вставлений HTML з класами читається назад, стилі відкидаються', () => {
    const e = new Editor({
      extensions: paperExtensions(),
      injectCSS: false,
      content: '<p class="ta-right in-1"><span class="fs-12 tc-red">а</span><span style="color:red">б</span></p>',
    });
    const json = e.getJSON();
    expect(json.content?.[0]?.attrs).toEqual({ align: 'right', indent: 1 });
    expect(json.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'textStyle', attrs: { size: 12, color: 'red', font: null } }]);
    expect(json.content?.[0]?.content?.[1]?.marks).toBeUndefined();
    expect(checkContent(json)).toBe(true);
    e.destroy();
  });

  it('у paper.css є правило на кожен клас з опису', () => {
    const css = readFileSync(join(__dirname, '../../../shared/editor-schema/paper.css'), 'utf8');
    for (const c of formatClasses()) expect(css).toMatch(new RegExp(`\\.${c}\\b`));
  });
});
