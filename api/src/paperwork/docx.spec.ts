import { strFromU8, unzipSync } from 'fflate';
import type { PaperContent } from '../../../shared/editor-schema';
import type { FieldFill } from '../../../shared/editor-schema/render';
import { docxFileName, paperDocx, parseSheet } from './docx';
import { sheetHtml } from './print';

const doc = (...content: unknown[]) =>
  ({ type: 'doc', content }) as PaperContent;
const p = (content: unknown[], attrs?: object) => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content,
});
const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const cell = (type: string, t: string, attrs?: object) => ({
  type,
  ...(attrs ? { attrs } : {}),
  content: [p(t ? [text(t)] : [])],
});

const fill = (over: Partial<FieldFill> = {}): FieldFill => ({
  text: (k) => ({ who: 'Андрій ШЕВЧУК' })[k] ?? null,
  hidden: () => false,
  holds: () => false,
  title: () => null,
  number: 'ТЗ-2026-014',
  info: {
    institution: 'КОЛЕДЖ',
    groupName: 'Творча група DigiComp',
    signerPosition: 'Модератор',
    person: (who) =>
      ({ '@author': 'Андрій ШЕВЧУК', '@signer': 'Артур МАШТАЛЕР' })[who] ??
      null,
    date: '16.11.2026',
    year: '2026',
  },
  ...over,
});

/** The parts of a DOCX by their paths, as text. */
async function parts(paper: Parameters<typeof paperDocx>[0]) {
  const zip = unzipSync(new Uint8Array(await paperDocx(paper)));
  return Object.fromEntries(
    Object.entries(zip).map(([k, v]) => [k, strFromU8(v)]),
  );
}

async function body(content: PaperContent, f: FieldFill = fill()) {
  const x = await parts({
    title: 'Документ',
    sheet: sheetHtml(content, f),
    footer: '',
  });
  return x['word/document.xml']!;
}

/** The paragraphs' texts, in order. */
const texts = (xml: string) =>
  [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
  );

describe('DOCX: розбір аркуша', () => {
  it('теги, класи, атрибути й сутності; закривальний тег без відкривального пропускається', () => {
    const root = parseSheet(
      '<main class="paper" data-paper="a&amp;b"><p class="ta-center in-2">a &amp; &lt;b&gt;&nbsp;&#1072;</p></span><br></main>',
    );
    const main = root.children[0] as Exclude<(typeof root.children)[0], string>;
    expect(main.tag).toBe('main');
    expect(main.attrs['data-paper']).toBe('a&b');
    const para = main.children[0] as typeof main;
    expect([...para.cls]).toEqual(['ta-center', 'in-2']);
    expect(para.children).toEqual(['a & <b> а']);
    expect((main.children[1] as typeof main).tag).toBe('br');
  });
});

describe('DOCX: вміст', () => {
  it('аркуш A4 з полями ДСТУ, Times New Roman 14 pt, 1,5 інтервалу, українська мова', async () => {
    const x = await parts({
      title: 'Т',
      sheet: sheetHtml(doc(p([text('a')]))),
      footer: '',
    });
    const xml = x['word/document.xml']!;
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"');
    expect(xml).toMatch(
      /<w:pgMar w:top="1134" w:right="567" w:bottom="1134" w:left="1701"/,
    );
    expect(xml).toContain('<w:titlePg/>');
    const styles = x['word/styles.xml']!;
    expect(styles).toContain('w:ascii="Times New Roman"');
    expect(styles).toContain('<w:sz w:val="28"/>');
    expect(styles).toContain('<w:lang w:val="uk-UA"/>');
    expect(styles).toMatch(/<w:spacing[^>]*w:line="360"/);
    expect(x['docProps/core.xml']).toContain('<dc:title>Т</dc:title>');
  });

  it('абзац з відступом 10 мм; по центру й праворуч — без нього; відступ ліворуч кроком 5 мм', async () => {
    const xml = await body(
      doc(
        p([text('звичайний')]),
        p([text('центр')], { align: 'center' }),
        p([text('ширина')], { align: 'justify', indent: 2 }),
      ),
    );
    const ps = [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
    expect(ps[0]).toContain('<w:ind w:firstLine="567"/>');
    expect(ps[1]).toContain('<w:jc w:val="center"/>');
    expect(ps[1]).not.toContain('w:firstLine');
    expect(ps[2]).toContain('<w:jc w:val="both"/>');
    expect(ps[2]).toContain('<w:ind w:left="567" w:firstLine="567"/>');
  });

  it('позначки й класи тексту: жирний, курсив, закреслений, підкреслений, розмір, колір, шрифт', async () => {
    const xml = await body(
      doc(
        p([
          text('ж', [{ type: 'bold' }]),
          text('к', [{ type: 'italic' }]),
          text('з', [{ type: 'strike' }]),
          text('п', [{ type: 'underline' }]),
          text('стиль', [
            {
              type: 'textStyle',
              attrs: { size: 18, color: 'red', font: 'sans' },
            },
          ]),
        ]),
      ),
    );
    expect(xml).toMatch(/<w:b\/>[\s\S]*?>ж</);
    expect(xml).toMatch(/<w:i\/>[\s\S]*?>к</);
    expect(xml).toMatch(/<w:strike\/>[\s\S]*?>з</);
    expect(xml).toMatch(/<w:u w:val="single"\/>[\s\S]*?>п</);
    expect(xml).toMatch(
      /<w:rFonts w:ascii="Arial"[^>]*\/><w:color w:val="B42828"\/><w:sz w:val="36"\/>[\s\S]*?>стиль</,
    );
  });

  it('заголовки — стилі Word; розрив сторінки — з наступного абзацу', async () => {
    const xml = await body(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Етапи')] },
        { type: 'pageBreak' },
        p([text('далі')]),
      ),
    );
    expect(xml).toMatch(/<w:pStyle w:val="Heading2"\/>[\s\S]*?>Етапи</);
    expect(xml).toMatch(/<w:pageBreakBefore\/>[\s\S]*?>далі</);
  });

  it('списки: номер з `start`, вкладений — рівнем нижче, другий абзац пункту — без номера', async () => {
    const x = await parts({
      title: 'Т',
      sheet: sheetHtml(
        doc({
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [
                p([text('три')]),
                {
                  type: 'bulletList',
                  content: [
                    { type: 'listItem', content: [p([text('вкладений')])] },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [p([text('чотири')]), p([text('ще абзац')])],
            },
          ],
        }),
        fill(),
      ),
      footer: '',
    });
    const xml = x['word/document.xml']!;
    const para = (t: string) =>
      [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)]
        .map((m) => m[0])
        .find((s) => s.includes(`>${t}<`))!;
    expect(para('три')).toMatch(/<w:numPr><w:ilvl w:val="0"\/>/);
    expect(para('вкладений')).toMatch(/<w:numPr><w:ilvl w:val="1"\/>/);
    expect(para('чотири')).toMatch(/<w:numPr><w:ilvl w:val="0"\/>/);
    expect(para('ще абзац')).not.toContain('w:numPr');
    expect(para('ще абзац')).toContain('<w:ind w:left="567"/>');
    const numbering = x['word/numbering.xml']!;
    expect(numbering).toContain('<w:start w:val="3"/>');
    expect(numbering).toContain('<w:lvlText w:val="•"/>');
  });

  it("таблиця: рамки, об'єднані клітинки, шапка жирна; порожня клітинка — порожній абзац", async () => {
    const xml = await body(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell('tableHeader', 'дві', { colspan: 2 }),
              cell('tableHeader', 'третя'),
            ],
          },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', 'вниз', { rowspan: 2 }),
              cell('tableCell', 'б'),
              cell('tableCell', ''),
            ],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', 'г'), cell('tableCell', 'д')],
          },
        ],
      }),
    );
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(xml).toMatch(/<w:insideV w:val="single" w:color="0E1A2B"/);
    expect(xml.match(/<w:gridCol /g)).toHaveLength(3);
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toMatch(/<w:b\/>[\s\S]*?>дві</);
  });

  it('дві таблиці поспіль не зливаються: між ними тонкий абзац; документ закінчується абзацом', async () => {
    const table = {
      type: 'table',
      content: [{ type: 'tableRow', content: [cell('tableCell', 'a')] }],
    };
    const xml = await body(doc(table, table));
    expect(xml).toMatch(
      /<\/w:tbl><w:p><w:pPr><w:spacing w:line="120" w:lineRule="exact"\/><\/w:pPr><\/w:p><w:tbl>/,
    );
    expect(xml).toMatch(/<\/w:tbl><w:p>[\s\S]*?<\/w:p><w:sectPr/);
  });

  it('поля: значення текстом, порожнє — підкреслений рядок; у повторюваних рядках — без рядка', async () => {
    const xml = await body(
      doc(
        p([
          { type: 'field', attrs: { key: 'who' } },
          text(' / '),
          { type: 'field', attrs: { key: 'due' } },
        ]),
        {
          type: 'repeat',
          attrs: { key: 'rows' },
          content: [
            {
              type: 'table',
              content: [
                { type: 'tableRow', content: [cell('tableHeader', 'Що')] },
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableCell',
                      content: [p([{ type: 'field', attrs: { key: 'what' } }])],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ),
    );
    expect(xml).toContain('>Андрій ШЕВЧУК<');
    // One blank line: the field in the text; the row's empty cell has none.
    expect(xml.match(/<w:u w:val="single"\/>/g)).toHaveLength(1);
    expect(texts(xml)[0]).toMatch(/^Андрій ШЕВЧУК \/  {20,}$/);
  });

  it('шапка по центру з лінією, «Затверджую» праворуч, підписи — таблиця без рамок', async () => {
    const xml = await body(
      doc(
        { type: 'orgHeader' },
        { type: 'approval' },
        {
          type: 'signatures',
          attrs: {
            leftLabel: 'Склав',
            leftSigner: '@author',
            rightLabel: 'Погодив',
            rightSigner: null,
          },
        },
      ),
    );
    expect(xml).toMatch(/<w:jc w:val="center"\/>[\s\S]*?>КОЛЕДЖ</);
    expect(xml).toMatch(
      /<w:pBdr><w:bottom w:val="single"[^>]*\/><\/w:pBdr>[\s\S]*?>Творча група DigiComp</,
    );
    expect(xml).toMatch(/<w:ind w:left="4819"\/>[\s\S]*?>ЗАТВЕРДЖУЮ</);
    expect(xml).toMatch(/<w:tblBorders><w:top w:val="none"/);
    const t = texts(xml);
    expect(t).toContain('Склав');
    expect(t.some((s) => /^ +  Андрій ШЕВЧУК$/.test(s))).toBe(true);
    expect(t.some((s) => /^ +  Артур МАШТАЛЕР$/.test(s))).toBe(true);
  });

  it('авто-таблиця: 12 pt, підпис над нею, шапка повторюється, «і ще N» — курсивом на всю ширину', async () => {
    const xml = await body(
      doc({ type: 'autoTable', attrs: { source: 's', field: 'f' } }),
      fill({
        table: () => ({
          columns: ['Дата', 'Хто'],
          caption: 'Листопад 2026',
          rows: [['01.11', 'Іван']],
          more: 3,
        }),
      }),
    );
    expect(xml).toMatch(
      /<w:b\/>[\s\S]*?<w:sz w:val="24"\/>[\s\S]*?>Листопад 2026</,
    );
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toMatch(
      /<w:gridSpan w:val="2"\/>[\s\S]*?<w:i\/>[\s\S]*?<w:color w:val="46566E"\/>[\s\S]*?>… і ще 3 раніші рядки</,
    );
    expect(xml).toMatch(/<w:sz w:val="24"\/>[\s\S]*?>Іван</);
  });

  it('незнайомий тег пропускається, його текст лишається', async () => {
    const x = await parts({
      title: 'Т',
      sheet:
        '<main class="paper"><p>а <blink>б</blink> в</p><aside>г</aside></main>',
      footer: '',
    });
    expect(texts(x['word/document.xml']!)).toEqual(['а б в', 'г']);
  });

  it('зображення: окремим абзацом, частка ширини тексту, пропорції файлу, бік і опис; без файлу — «[зображення]»', async () => {
    const a = '0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4';
    const b = '1c9f2d3e-4e5b-4c6d-9e7f-8091a2b3c4d5';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const x = await parts({
      title: 'Т',
      sheet: sheetHtml(
        doc(
          {
            type: 'image',
            attrs: { id: a, width: 50, align: 'right', alt: 'Схема' },
          },
          { type: 'image', attrs: { id: b } },
        ),
        fill(),
      ),
      footer: '',
      images: new Map([
        [a, { type: 'png' as const, data: png, width: 400, height: 200 }],
      ]),
    });
    const xml = x['word/document.xml']!;
    // 170 мм тексту = 643 px; половина — 322 × 161 px (EMU: × 9525).
    expect(xml).toContain('cx="3067050" cy="1533525"');
    expect(xml).toContain('descr="Схема"');
    expect(xml).toMatch(/<w:jc w:val="right"\/>[\s\S]*<w:drawing>/);
    expect(Object.keys(x).some((k) => /^word\/media\/.+\.png$/.test(k))).toBe(
      true,
    );
    // Абзац зображення без тексту, потім той, де файлу немає.
    expect(texts(xml)).toEqual(['', '[зображення]']);
  });
});

describe('DOCX: копія й позначка', () => {
  it('незафіксований: позначка на кожній сторінці, номер — з другої, колонтитул внизу', async () => {
    const x = await parts({
      title: 'Т',
      sheet: sheetHtml(doc(p([text('a')]))),
      footer: 'ТЗ-2026-014',
      mark: 'Чернетка',
    });
    const headers = Object.keys(x).filter((k) =>
      /^word\/header\d+\.xml$/.test(k),
    );
    expect(headers).toHaveLength(2);
    for (const h of headers) expect(x[h]).toContain('>ЧЕРНЕТКА<');
    expect(headers.filter((h) => x[h]!.includes('PAGE'))).toHaveLength(1);
    const footers = Object.keys(x).filter((k) =>
      /^word\/footer\d+\.xml$/.test(k),
    );
    for (const f of footers) expect(x[f]).toContain('>ТЗ-2026-014<');
    expect(x['word/document.xml']).not.toContain('Копія документа');
  });

  it('копія знімка: наприкінці — коли зафіксовано, посилання на перевірку й SHA-256; без позначки', async () => {
    const sha = 'ab'.repeat(32);
    const x = await parts({
      title: 'Т',
      sheet: `<main class="paper" data-paper="x" data-snapshot="1"><p>a</p></main>`,
      footer: '',
      seal: {
        sha256: sha,
        frozenOn: '16.11.2026',
        url: `https://hub.example/papers/verify/${sha}`,
      },
    });
    const xml = x['word/document.xml']!;
    expect(xml).toContain('Копія документа, зафіксованого 16.11.2026.');
    expect(xml).toContain(`>https://hub.example/papers/verify/${sha}<`);
    expect(x['word/_rels/document.xml.rels']).toContain(
      `Target="https://hub.example/papers/verify/${sha}"`,
    );
    expect(xml).toContain(`>SHA-256: ${sha}<`);
    for (const k of Object.keys(x).filter((k) => k.startsWith('word/header'))) {
      expect(x[k]).not.toContain('ЧЕРНЕТКА');
    }
  });

  it('без PUBLIC_ORIGIN — без посилання, лише хеш', async () => {
    const x = await parts({
      title: 'Т',
      sheet: '<main class="paper"><p>a</p></main>',
      footer: '',
      seal: { sha256: 'cd'.repeat(32), frozenOn: '16.11.2026', url: null },
    });
    expect(texts(x['word/document.xml']!)).toContain(
      'Копія документа, зафіксованого 16.11.2026. Справжність перевіряють за оригіналом.',
    );
    expect(x['word/document.xml']).not.toContain('w:hyperlink');
  });
});

describe("DOCX: ім'я файлу", () => {
  it('номер і назва; заборонені символи замінено', () => {
    expect(docxFileName('Пайка: плата / v2?', 'ТЗ-2026-014')).toBe(
      'ТЗ-2026-014 Пайка_ плата _ v2_.docx',
    );
    expect(docxFileName('Чернетка', null)).toBe('Чернетка.docx');
    expect(docxFileName('  ', null)).toBe('Документ.docx');
  });
});
