import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  checkContent,
  COLORS,
  SHEET_COLORS,
  type PaperContent,
} from '../../../shared/editor-schema';
import {
  renderContent,
  type FieldFill,
  type PaperInfo,
} from '../../../shared/editor-schema/render';
import { footerText } from '../../../shared/editor-schema/render';
import {
  paperPrintHtml,
  qrSvg,
  SANS_FONT,
  sheetHash,
  sheetHtml,
} from './print';

const REPO = join(__dirname, '../../..');

const doc = (...content: unknown[]) =>
  ({ type: 'doc', content }) as PaperContent;
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, extra: object = {}) => ({
  type: 'text',
  text: t,
  ...extra,
});

const info = (over: Partial<PaperInfo> = {}): PaperInfo => ({
  institution: 'КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ',
  groupName: 'Творча група DigiComp',
  signerPosition: 'Модератор творчої групи DigiComp',
  person: (who) =>
    ({ '@author': 'Андрій ШЕВЧУК', '@signer': 'Артур МАШТАЛЕР' })[who] ?? null,
  date: '15.11.2026',
  year: '2026',
  ...over,
});

const fill = (over: Partial<PaperInfo> = {}): FieldFill => ({
  text: () => null,
  hidden: () => false,
  holds: () => false,
  title: () => null,
  number: null,
  info: info(over),
});

const styleOf = (html: string) => /<style>([\s\S]*)<\/style>/.exec(html)![1]!;

type PageInput = Parameters<typeof paperPrintHtml>[0];

const page = (
  over: Partial<Omit<PageInput, 'sheet' | 'footer'>> & {
    content?: PaperContent;
  } = {},
) => {
  const { content = doc(p(text('Текст'))), ...rest } = over;
  return paperPrintHtml({
    title: 'Документ',
    sheet: sheetHtml(content, fill()),
    footer: footerText(content),
    ...rest,
  });
};

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
  const hashOf = (style: string) =>
    createHash('sha256').update(style).digest('base64');

  it('стиль сторінки дозволено хешем у CSP; шрифти й зображення — лише свої', () => {
    const { html, csp } = page();
    expect(csp).toContain(`style-src 'sha256-${hashOf(styleOf(html))}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self';");
    expect(csp).not.toContain('script-src');
  });

  it('A4 з полями за ДСТУ, вигляд аркуша з paper.css', () => {
    const { html } = page();
    expect(html).toContain('size: A4; margin: 20mm 10mm 20mm 30mm');
    const paperCss = readFileSync(
      join(REPO, 'shared/editor-schema/paper.css'),
      'utf8',
    );
    expect(html).toContain(paperCss);
  });

  it('шапки сам друк не додає; назва — лише в заголовку вкладки', () => {
    const { html } = page({ title: 'Мій документ' });
    expect(html).toContain('<main class="paper"><p>Текст</p></main>');
    expect(html).not.toContain('<header');
    expect(html).toContain('<title>Мій документ</title>');
    expect(html.match(/Мій документ/g)).toHaveLength(1);
  });

  it('колонтитул — унизу кожної сторінки, не в тексті; CSS-рядок екрановано, хеш — цього стилю', () => {
    const { html, csp } = page({
      content: doc(p(text('Текст')), {
        type: 'pageFooter',
        attrs: { text: 'Ф-01 "ТЗ" \\ </style><script>' },
      }),
    });
    const style = styleOf(html);
    expect(style).toContain(
      '@bottom-center { content: "Ф-01 \\22 ТЗ\\22  \\5c  \\3c /style>\\3c script>";',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<main class="paper"><p>Текст</p></main>');
    expect(csp).toContain(`style-src 'sha256-${hashOf(style)}'`);
    expect(page().html).not.toContain('@bottom-center');
  });

  it('екранує назву; у сторінці немає скриптів і style=', () => {
    const { html } = page({ title: '</title><script>x</script>' });
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('style=');
  });
});

describe('Знімок: аркуш, хеш, печатка, водяний знак', () => {
  const SHA = 'a'.repeat(64);

  it('аркуш знімка називає документ і знімок; хеш — SHA-256 саме цього HTML', () => {
    const sheet = sheetHtml(doc(p(text('Текст'))), fill(), {
      paperId: 'p1',
      n: 2,
    });
    expect(sheet).toBe(
      '<main class="paper" data-paper="p1" data-snapshot="2"><p>Текст</p></main>',
    );
    expect(sheetHash(sheet)).toBe(
      createHash('sha256').update(sheet, 'utf8').digest('hex'),
    );
    // Той самий текст іншого документа — інший хеш.
    const other = sheetHtml(doc(p(text('Текст'))), fill(), {
      paperId: 'p2',
      n: 2,
    });
    expect(sheetHash(other)).not.toBe(sheetHash(sheet));
  });

  it('печатка: QR на сторінку перевірки, дата й повний хеш; поза аркушем', () => {
    const url = `https://digicomp.example/papers/verify/${SHA}`;
    const { html, csp } = page({
      seal: { sha256: SHA, frozenOn: '21.11.2026', url },
    });
    expect(html).toContain(
      '<main class="paper"><p>Текст</p></main><footer class="seal"><svg',
    );
    expect(html).toContain(qrSvg(url));
    expect(html).toContain('Документ зафіксовано 21.11.2026.');
    expect(html).toContain(`SHA-256: ${SHA}`);
    expect(html).not.toContain('style=');
    expect(csp).toContain("default-src 'none'");
  });

  it('без PUBLIC_ORIGIN — лише хеш, без QR', () => {
    const { html } = page({
      seal: { sha256: SHA, frozenOn: '21.11.2026', url: null },
    });
    expect(html).toContain(`SHA-256: ${SHA}`);
    expect(html).not.toContain('<svg');
  });

  it('QR — SVG без атрибута style', () => {
    const svg = qrSvg('https://digicomp.example/papers/verify/x');
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).not.toContain('style');
  });

  it('водяний знак — на кожній сторінці, екранований; без нього — чистий друк', () => {
    const { html } = page({ watermark: 'Не <зафіксовано>' });
    expect(html).toContain(
      '<div class="watermark" aria-hidden="true">Не &lt;зафіксовано&gt;</div>',
    );
    expect(styleOf(html)).toMatch(/\.watermark \{ position: fixed;/);
    expect(page().html).not.toContain('class="watermark"');
  });

  it('у підказці — посилання на копію DOCX (екрановане); без адреси — без посилання', () => {
    const { html } = page({ docx: '/api/papers/x/docx?snapshot=2&a' });
    expect(html).toMatch(
      /<p class="hint">[^<]*<a href="\/api\/papers\/x\/docx\?snapshot=2&amp;a" download>Завантажити копію DOCX<\/a><\/p>/,
    );
    expect(page().html).not.toContain('DOCX');
  });
});

describe('Блоки структури', () => {
  const sign = (attrs: Record<string, unknown> = {}) => ({
    type: 'signatures',
    attrs,
  });

  it('у спільному описі лише на верхньому рівні аркуша', () => {
    expect(checkContent(doc({ type: 'orgHeader' }, { type: 'approval' }))).toBe(
      true,
    );
    expect(
      checkContent(
        doc({
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'orgHeader' }] }],
        }),
      ),
    ).toBe(false);
    expect(
      checkContent(
        doc({ type: 'fieldZone', attrs: { key: 'z' }, content: [sign()] }),
      ),
    ).toBe(false);
  });

  it('підписи: хто підписує — автор, підписант, ключ поля; підпис — один рядок до 100 символів', () => {
    for (const who of ['@author', '@signer', 'chair', null]) {
      expect(checkContent(doc(sign({ leftSigner: who })))).toBe(true);
    }
    for (const bad of ['@admin', 'Chair', 7]) {
      expect(checkContent(doc(sign({ rightSigner: bad })))).toBe(false);
    }
    expect(checkContent(doc(sign({ leftLabel: 'a\nb' })))).toBe(false);
    expect(checkContent(doc(sign({ leftLabel: 'x'.repeat(101) })))).toBe(false);
    expect(
      checkContent(
        doc({ type: 'pageFooter', attrs: { text: 'x'.repeat(201) } }),
      ),
    ).toBe(false);
  });

  it('у HTML редактора — лише елемент з атрибутами (екрановано)', () => {
    expect(
      renderContent(
        doc(
          { type: 'orgHeader' },
          { type: 'approval' },
          sign({
            leftLabel: 'Видав "А" & Б',
            rightLabel: 'Прийняв',
            rightSigner: 'boss',
          }),
          { type: 'pageFooter', attrs: { text: 'Ф-01' } },
        ),
      ),
    ).toBe(
      '<div class="paper-org"></div><div class="paper-approval"></div>' +
        '<div class="paper-signs" data-left-label="Видав &quot;А&quot; &amp; Б" data-left-signer="@author" data-right-label="Прийняв" data-right-signer="boss"></div>' +
        '<div class="paper-footer" data-text="Ф-01"></div>',
    );
  });

  it('у друці: шапка й гриф з реквізитів, підписи з іменами, порожнє — лінія', () => {
    const html = renderContent(
      doc(
        { type: 'orgHeader' },
        { type: 'approval' },
        sign({
          leftLabel: 'Завдання видав',
          rightLabel: 'Роботу прийняв',
          rightSigner: 'boss',
        }),
      ),
      fill(),
    );
    expect(html).toBe(
      '<header class="paper-org"><p class="paper-org-institution">КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ</p><p class="paper-org-group">Творча група DigiComp</p></header>' +
        '<div class="paper-approval"><p class="paper-approval-title">ЗАТВЕРДЖУЮ</p><p>Модератор творчої групи DigiComp</p>' +
        '<p class="paper-sign"><span class="paper-sign-line"></span><span class="paper-sign-name">Артур МАШТАЛЕР</span></p>' +
        '<p class="paper-approval-date">«<span class="paper-sign-day"></span>» <span class="paper-sign-month"></span> 2026 р.</p></div>' +
        '<div class="paper-signs"><div class="paper-signs-col"><p>Завдання видав</p><p class="paper-sign"><span class="paper-sign-line"></span><span class="paper-sign-name">Андрій ШЕВЧУК</span></p></div>' +
        '<div class="paper-signs-col"><p>Роботу прийняв</p><p class="paper-sign"><span class="paper-sign-line"></span></p></div></div>',
    );
  });

  it('без правої колонки — одна; без реквізитів шапки немає, з однією частиною — лише вона', () => {
    expect(renderContent(doc(sign()), fill())).toBe(
      '<div class="paper-signs"><div class="paper-signs-col"><p>Склав</p><p class="paper-sign"><span class="paper-sign-line"></span><span class="paper-sign-name">Андрій ШЕВЧУК</span></p></div></div>',
    );
    expect(
      renderContent(
        doc({ type: 'orgHeader' }),
        fill({ institution: ' ', groupName: '' }),
      ),
    ).toBe('');
    expect(
      renderContent(
        doc({ type: 'orgHeader' }),
        fill({ institution: '', groupName: '<Група>' }),
      ),
    ).toBe(
      '<header class="paper-org"><p class="paper-org-group">&lt;Група&gt;</p></header>',
    );
  });

  it('«Авто: дата» й «Авто: автор»: у редакторі — порожні місця, у друці — текст або лінія', () => {
    const body = doc(
      p({ type: 'paperDate' }, text(' '), { type: 'paperAuthor' }),
    );
    expect(checkContent(body)).toBe(true);
    expect(renderContent(body)).toBe(
      '<p><span class="paper-date"></span> <span class="paper-author"></span></p>',
    );
    expect(renderContent(body, fill())).toBe(
      '<p><span class="paper-field">15.11.2026</span> <span class="paper-field">Андрій ШЕВЧУК</span></p>',
    );
    expect(renderContent(body, fill({ date: null, person: () => null }))).toBe(
      '<p><span class="paper-field-blank"></span> <span class="paper-field-blank"></span></p>',
    );
  });
});

describe('Авто-таблиця', () => {
  const table = {
    type: 'autoTable',
    attrs: { source: 'place_sessions', field: 'place' },
  };
  const withTable = (
    t: ReturnType<NonNullable<FieldFill['table']>>,
  ): FieldFill => ({
    ...fill(),
    table: (source, key) =>
      source === 'place_sessions' && key === 'place' ? t : null,
  });

  it('у спільному описі — лише на верхньому рівні, з джерелом і полем', () => {
    expect(checkContent(doc(table))).toBe(true);
    expect(
      checkContent(
        doc({ type: 'autoTable', attrs: { source: 'place_sessions' } }),
      ),
    ).toBe(false);
    expect(
      checkContent(
        doc({
          type: 'autoTable',
          attrs: { source: 'Bad key', field: 'place' },
        }),
      ),
    ).toBe(false);
    expect(
      checkContent(
        doc({
          type: 'conditional',
          attrs: { field: 'k', value: 'a' },
          content: [table],
        }),
      ),
    ).toBe(false);
  });

  it('у HTML редактора — лише елемент із джерелом і полем', () => {
    expect(renderContent(doc(table))).toBe(
      '<div class="paper-table" data-source="place_sessions" data-field="place"></div>',
    );
  });

  it('у друці: підпис, заголовок зі стовпців, рядки (екрановано), «і ще N» — над ними', () => {
    const html = renderContent(
      doc(table),
      withTable({
        columns: ['Учасник', 'Початок'],
        caption: 'Листопад 2026',
        rows: [['<Олена>', '01.11.2026 10:00']],
        more: 3,
      }),
    );
    expect(html).toBe(
      '<div class="paper-table"><p class="paper-table-caption">Листопад 2026</p><table><tbody>' +
        '<tr><th>Учасник</th><th>Початок</th></tr>' +
        '<tr><td colspan="2" class="paper-table-more">… і ще 3 раніші рядки</td></tr>' +
        '<tr><td>&lt;Олена&gt;</td><td>01.11.2026 10:00</td></tr></tbody></table></div>',
    );
  });

  it('поле ще порожнє — один порожній рядок; записів немає — «Записів немає»; без даних — нічого', () => {
    const empty = renderContent(
      doc(table),
      withTable({ columns: ['А', 'Б'], caption: null, rows: null, more: 0 }),
    );
    expect(empty).toContain('<tr><td></td><td></td></tr>');
    const none = renderContent(
      doc(table),
      withTable({ columns: ['А', 'Б'], caption: null, rows: [], more: 0 }),
    );
    expect(none).toContain(
      '<td colspan="2" class="paper-table-none">Записів немає</td>',
    );
    expect(renderContent(doc(table), fill())).toBe('');
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
