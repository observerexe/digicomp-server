import { strFromU8, unzipSync } from 'fflate';
import type { PaperContent } from '../../../shared/editor-schema';
import {
  signLines,
  type FieldFill,
} from '../../../shared/editor-schema/render';
import { paperDocx } from './docx';
import { paperPrintHtml, sheetHtml } from './print';
import {
  SIGN_HEIGHT,
  SIGN_LIMITS,
  SIGN_WIDTH,
  signatureSvg,
  signedSheet,
  strokesValid,
} from './signatures';

const doc = (...content: unknown[]) =>
  ({ type: 'doc', content }) as PaperContent;
const p = (t: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: t }],
});
const signs = (attrs: object = {}) => ({ type: 'signatures', attrs });

const NAMES: Record<string, string> = {
  '@author': 'Андрій ШЕВЧУК',
  '@signer': 'Артур МАШТАЛЕР',
  acceptedBy: 'Олена КОВАЛЬ',
};

const fill: FieldFill = {
  text: () => null,
  hidden: () => false,
  holds: () => false,
  title: () => null,
  number: null,
  info: {
    institution: '',
    groupName: '',
    signerPosition: 'Модератор',
    person: (who) => NAMES[who] ?? null,
    date: null,
    year: '2026',
  },
};

const lines = (sheet: string) =>
  sheet.match(/<span class="paper-sign-line">/g)?.length ?? 0;

describe('Лінії підпису аркуша (signLines)', () => {
  const content = doc(
    { type: 'approval' },
    p('Текст'),
    signs({
      leftLabel: 'Завдання видав',
      rightLabel: 'Роботу прийняв',
      rightSigner: 'acceptedBy',
    }),
    signs({ leftLabel: 'Склав', leftSigner: null }),
    signs({
      leftLabel: 'Погодив',
      leftSigner: '@signer',
      rightLabel: '',
      rightSigner: '@author',
    }),
  );

  it('у порядку аркуша: «Затверджую», колонки; права — лише з назвою; підписант — за замовчуванням автор', () => {
    expect(signLines(content)).toEqual([
      { label: 'Затверджую', signer: '@signer' },
      { label: 'Завдання видав', signer: '@author' },
      { label: 'Роботу прийняв', signer: 'acceptedBy' },
      { label: 'Склав', signer: null },
      { label: 'Погодив', signer: '@signer' },
    ]);
  });

  it('скільки ліній на аркуші — стільки й рядків', () => {
    expect(lines(sheetHtml(content, fill))).toBe(signLines(content).length);
    expect(signLines(doc(p('Без підписів')))).toEqual([]);
  });
});

describe('Штрихи підпису', () => {
  it('приймає штрихи в межах поля, зокрема крапку', () => {
    expect(
      strokesValid([
        [0, 0, SIGN_WIDTH, SIGN_HEIGHT],
        [10, 20],
      ]),
    ).toBe(true);
  });

  it.each([
    ['не масив', 'M0 0'],
    ['порожній', []],
    ['порожній штрих', [[]]],
    ['непарна кількість чисел', [[1, 2, 3]]],
    ['дробові', [[1.5, 2]]],
    ['від’ємні', [[-1, 2]]],
    ['x поза полем', [[SIGN_WIDTH + 1, 0]]],
    ['y поза полем', [[0, SIGN_HEIGHT + 1]]],
    ['рядок замість числа', [['1', 2]]],
    [
      'забагато штрихів',
      Array.from({ length: SIGN_LIMITS.strokes + 1 }, () => [1, 1]),
    ],
    [
      'задовгий штрих',
      [Array.from({ length: (SIGN_LIMITS.strokePoints + 1) * 2 }, () => 1)],
    ],
    [
      'забагато точок разом',
      Array.from({ length: 7 }, () =>
        Array.from({ length: 1000 * 2 }, () => 1),
      ),
    ],
  ])('відхиляє: %s', (_label, v) => {
    expect(strokesValid(v)).toBe(false);
  });

  it('SVG малює сервер: один шлях без style, крапка — нульовий відрізок', () => {
    const svg = signatureSvg([
      [1, 2, 3, 4, 5, 6],
      [7, 8],
    ]);
    expect(svg).toContain('d="M1 2L3 4L5 6M7 8l0 0"');
    expect(svg).toContain(`viewBox="0 0 ${SIGN_WIDTH} ${SIGN_HEIGHT}"`);
    expect(svg).not.toMatch(/style=/);
    expect(svg).toContain('stroke="currentColor"');
  });
});

describe('Підписи поверх аркуша (signedSheet)', () => {
  const content = doc(
    { type: 'approval' },
    signs({
      leftLabel: 'Склав',
      rightLabel: 'Прийняв',
      rightSigner: 'acceptedBy',
    }),
  );
  const sheet = sheetHtml(content, fill, { paperId: 'p1', n: 1 });

  it('малюнок — у своїй лінії, примітка — під нею; інші лінії як були', () => {
    const out = signedSheet(sheet, [
      {
        row: 2,
        strokes: [[1, 1, 2, 2]],
        note: 'Підписано в DigiComp HUB 16.11.2026, 14:32',
      },
    ]);
    expect(lines(out)).toBe(3);
    expect(out.match(/<span class="paper-sign-line"><\/span>/g)).toHaveLength(
      2,
    );
    expect(out.match(/<svg class="paper-signature"/g)).toHaveLength(1);
    const col = out.split('<div class="paper-signs-col">')[2]!;
    expect(col).toContain('<span class="paper-sign-line"><svg');
    expect(col).toContain(
      'Олена КОВАЛЬ</span></p><p class="paper-signed-note">Підписано в DigiComp HUB 16.11.2026, 14:32</p>',
    );
  });

  it('без підписів аркуш той самий; примітка екранується', () => {
    expect(signedSheet(sheet, [])).toBe(sheet);
    expect(
      signedSheet(sheet, [{ row: 0, strokes: [[1, 1]], note: '<b>' }]),
    ).toContain('&lt;b&gt;');
  });

  it('друк: підпис без style, CSP не слабшає', () => {
    const { html, csp } = paperPrintHtml({
      title: 'Документ',
      sheet: signedSheet(sheet, [
        { row: 0, strokes: [[1, 1, 9, 9]], note: 'Підписано' },
      ]),
      footer: '',
    });
    expect(html).toContain('<svg class="paper-signature"');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    expect(csp).toContain("default-src 'none'");
  });

  it('DOCX: примітка під лінією, малюнок не копіюється', async () => {
    const file = await paperDocx({
      title: 'Документ',
      sheet: signedSheet(sheet, [
        {
          row: 1,
          strokes: [[1, 1, 9, 9]],
          note: 'Підписано в DigiComp HUB: Андрій ШЕВЧУК, 16.11.2026, 14:32',
        },
      ]),
      footer: '',
      seal: null,
      mark: null,
    });
    const xml = documentXml(file);
    expect(xml).toContain(
      'Підписано в DigiComp HUB: Андрій ШЕВЧУК, 16.11.2026, 14:32',
    );
    expect(xml).not.toContain('svg');
  });
});

/** word/document.xml of a DOCX. */
function documentXml(file: Buffer): string {
  return strFromU8(unzipSync(new Uint8Array(file))['word/document.xml']!);
}
