import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  COLORS,
  SHEET_COLORS,
  type PaperContent,
} from '../../../shared/editor-schema';
import { renderContent } from '../../../shared/editor-schema/render';
import { paperPrintHtml, PRINT_CSP, SANS_FONT } from './print';

const REPO = join(__dirname, '../../..');

const doc = (...content: unknown[]) =>
  ({ type: 'doc', content }) as PaperContent;
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, extra: object = {}) => ({
  type: 'text',
  text: t,
  ...extra,
});

const requisites = {
  institution: 'КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ',
  groupName: 'Творча група DigiComp',
};

const page = (over: Partial<Parameters<typeof paperPrintHtml>[0]> = {}) =>
  paperPrintHtml({
    title: 'Документ',
    content: doc(p(text('Текст'))),
    requisites,
    ...over,
  });

describe('Рендер вмісту для друку (shared/editor-schema/render.ts)', () => {
  it('екранує текст', () => {
    expect(renderContent(doc(p(text('<script>alert(1)</script> & co'))))).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>',
    );
  });

  it('недозволені значення атрибутів не потрапляють у HTML', () => {
    const html = renderContent(
      doc(
        {
          type: 'paragraph',
          attrs: { align: '"><script>', indent: 99, style: 'color:red' },
          content: [
            text('a', {
              marks: [
                {
                  type: 'textStyle',
                  attrs: { size: 'x" onclick="', color: 'pink', font: null },
                },
              ],
            }),
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: '1"><b' },
          content: [{ type: 'listItem', content: [p(text('b'))] }],
        },
        {
          type: 'heading',
          attrs: { level: 9 },
          content: [text('c')],
        },
      ),
    );
    expect(html).toBe(
      '<p><span>a</span></p><ol><li><p>b</p></li></ol><h1>c</h1>',
    );
  });

  it('невідомі вузли й позначки пропускаються', () => {
    const html = renderContent(
      doc(
        { type: 'script', content: [text('x')] },
        p(text('y', { marks: [{ type: 'link', attrs: { href: 'evil' } }] })),
      ),
    );
    expect(html).toBe('<p>y</p>');
  });

  it('класи форматування й розрив сторінки', () => {
    const html = renderContent(
      doc(
        {
          type: 'paragraph',
          attrs: { align: 'center', indent: 2 },
          content: [
            text('a', {
              marks: [
                { type: 'bold' },
                { type: 'textStyle', attrs: { size: 18, color: 'blue' } },
              ],
            }),
          ],
        },
        { type: 'pageBreak' },
      ),
    );
    expect(html).toBe(
      '<p class="ta-center in-2"><span class="fs-18 tc-blue"><strong>a</strong></span></p><div class="page-break"></div>',
    );
  });
});

describe('Сторінка друку документа', () => {
  it('стиль сторінки дозволено хешем у CSP', () => {
    const style = /<style>([\s\S]*)<\/style>/.exec(page())![1]!;
    const hash = createHash('sha256').update(style).digest('base64');
    expect(PRINT_CSP).toContain(`style-src 'sha256-${hash}'`);
    expect(PRINT_CSP).toContain("default-src 'none'");
    expect(PRINT_CSP).toContain("font-src 'self'");
    expect(PRINT_CSP).not.toContain('script-src');
  });

  it('A4 з полями за ДСТУ, вигляд аркуша з paper.css', () => {
    const html = page();
    expect(html).toContain('size: A4; margin: 20mm 10mm 20mm 30mm');
    const paperCss = readFileSync(
      join(REPO, 'shared/editor-schema/paper.css'),
      'utf8',
    );
    expect(html).toContain(paperCss);
  });

  it('шапка з реквізитів, назва — лише в заголовку вкладки', () => {
    const html = page({ title: 'Мій документ' });
    expect(html).toContain(
      '<header class="org"><p class="org-institution">КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ</p><p class="org-group">Творча група DigiComp</p></header><p>Текст</p>',
    );
    expect(html).toContain('<title>Мій документ</title>');
    expect(html.match(/Мій документ/g)).toHaveLength(1);
  });

  it('без реквізитів шапки немає; лише одна частина — лише вона', () => {
    expect(
      page({ requisites: { institution: ' ', groupName: '' } }),
    ).not.toContain('<header');
    expect(
      page({ requisites: { institution: '', groupName: 'Група' } }),
    ).toContain('<header class="org"><p class="org-group">Група</p></header>');
  });

  it('екранує назву й реквізити; у сторінці немає скриптів і style=', () => {
    const html = page({
      title: '</title><script>x</script>',
      requisites: { institution: '<b>"Коледж"</b>', groupName: "О'Брайен" },
    });
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;&quot;Коледж&quot;&lt;/b&gt;');
    expect(html).toContain('О&#39;Брайен');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('style=');
  });
});

describe('Кольори й шрифт аркуша = docs/design/tokens.json', () => {
  type Tokens = {
    color: { light: { surface: string; text: string } };
    palette: Record<string, { light: { text: string } }>;
    font: { body: string; fallback: string };
  };
  const tokens = JSON.parse(
    readFileSync(join(REPO, 'docs/design/tokens.json'), 'utf8'),
  ) as Tokens;

  it('SHEET_COLORS', () => {
    expect(SHEET_COLORS).toEqual({
      paper: tokens.color.light.surface,
      ink: tokens.color.light.text,
      ...Object.fromEntries(
        COLORS.map((c) => [c, tokens.palette[c]!.light.text]),
      ),
    });
  });

  it('шрифт без зарубок', () => {
    expect(SANS_FONT).toBe(`'${tokens.font.body}', ${tokens.font.fallback}`);
  });
});
