import { createHash } from 'crypto';
import {
  durationMinutes,
  formatDuration,
  formatLocal,
  LogRow,
  REPORT_CSP,
  sessionsCsv,
  sessionsReportHtml,
} from './session-log';

const row = (over: Partial<LogRow> = {}): LogRow => ({
  placeTitle: 'Лазер',
  placeCode: 'LASER-1',
  userName: 'Олена',
  startedAt: new Date('2026-11-03T08:00:00Z'),
  endedAt: new Date('2026-11-03T10:30:00Z'),
  endedByName: 'Олена',
  endedByOther: false,
  endReason: '',
  autoClosed: false,
  ...over,
});

describe('Журнал обладнання: формат', () => {
  it('час у київському поясі', () => {
    // Листопад: UTC+2.
    expect(formatLocal(new Date('2026-11-03T08:00:00Z'))).toBe(
      '2026-11-03 10:00',
    );
    // Липень: UTC+3.
    expect(formatLocal(new Date('2026-07-03T08:00:00Z'))).toBe(
      '2026-07-03 11:00',
    );
  });

  it('тривалість у хвилинах і год:хв', () => {
    expect(durationMinutes(row())).toBe(150);
    expect(formatDuration(150)).toBe('2:30');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(25 * 60)).toBe('25:00');
    expect(durationMinutes(row({ endedAt: null }))).toBeNull();
    expect(formatDuration(null)).toBe('');
  });

  it('CSV: BOM, заголовок, примітки, захист від формул', () => {
    const csv = sessionsCsv([
      row(),
      row({ autoClosed: true, userName: '=HYPERLINK("x")' }),
      row({
        endedByOther: true,
        endedByName: 'Модератор',
        endReason: 'кінець дня',
      }),
      row({ endedAt: null }),
    ]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'Обладнання,Код,Особа,Початок,Кінець,Тривалість (год:хв),Хвилин,Примітка',
    );
    expect(lines[1]).toBe(
      'Лазер,LASER-1,Олена,2026-11-03 10:00,2026-11-03 12:30,2:30,150,',
    );
    expect(lines[2]).toContain('закрито автоматично');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[3]).toContain('завершив Модератор: кінець дня');
    expect(lines[4]).toMatch(/,,,триває$/);
  });

  it('HTML: екранування, підсумки, CSP лише для вбудованого стилю', () => {
    const html = sessionsReportHtml(
      [row({ userName: '<script>alert(1)</script>' }), row()],
      {
        from: new Date('2026-10-31T22:00:00Z'),
        to: new Date('2026-11-30T22:00:00Z'),
        filters: [],
        generatedAt: new Date('2026-12-01T09:00:00Z'),
      },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Період: 2026-11-01 00:00 — 2026-11-30 23:59');
    expect(html).toContain('Сеансів: 2 · Загальний час: 5:00');
    expect(html).toContain('Підсумок за обладнанням');
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    const hash = createHash('sha256').update(style).digest('base64');
    expect(REPORT_CSP).toContain(`'sha256-${hash}'`);
    expect(REPORT_CSP).toContain("default-src 'none'");
    expect(REPORT_CSP).not.toContain('script-src');
  });

  it('HTML: порожній період', () => {
    const html = sessionsReportHtml([], {
      from: new Date('2026-10-31T22:00:00Z'),
      to: new Date('2026-11-30T22:00:00Z'),
      filters: ['Обладнання: Лазер'],
      generatedAt: new Date(),
    });
    expect(html).toContain('За цей період сеансів немає');
    expect(html).not.toContain('Підсумок');
  });
});
