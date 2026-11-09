import { createHash } from 'crypto';
import { toCsv } from '../common/csv';

/** Times in exports are shown in local Kyiv time. */
export const LOG_TIMEZONE = 'Europe/Kyiv';

export type LogRow = {
  placeTitle: string;
  placeCode: string;
  userName: string;
  startedAt: Date;
  endedAt: Date | null;
  endedByName: string | null;
  endedByOther: boolean;
  endReason: string;
  autoClosed: boolean;
};

// sv-SE gives "2026-11-09 14:05", easy to read and to sort.
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: LOG_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatLocal(d: Date) {
  return fmt.format(d);
}

/** Whole minutes between start and end. */
export function durationMinutes(r: Pick<LogRow, 'startedAt' | 'endedAt'>) {
  if (!r.endedAt) return null;
  return Math.max(
    0,
    Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000),
  );
}

/** "H:MM" (hours may exceed 24). */
export function formatDuration(minutes: number | null) {
  if (minutes === null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function remark(r: LogRow) {
  if (!r.endedAt) return 'триває';
  if (r.autoClosed) return 'закрито автоматично';
  if (r.endedByOther) {
    return `завершив ${r.endedByName ?? 'інший'}${r.endReason ? `: ${r.endReason}` : ''}`;
  }
  return '';
}

export function sessionsCsv(rows: LogRow[]) {
  return toCsv(
    [
      'Обладнання',
      'Код',
      'Особа',
      'Початок',
      'Кінець',
      'Тривалість (год:хв)',
      'Хвилин',
      'Примітка',
    ],
    rows.map((r) => {
      const min = durationMinutes(r);
      return [
        r.placeTitle,
        r.placeCode,
        r.userName,
        formatLocal(r.startedAt),
        r.endedAt ? formatLocal(r.endedAt) : '',
        formatDuration(min),
        min ?? '',
        remark(r),
      ];
    }),
  );
}

function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

function totals(rows: LogRow[], key: (r: LogRow) => string) {
  const map = new Map<string, { count: number; minutes: number }>();
  for (const r of rows) {
    const t = map.get(key(r)) ?? { count: 0, minutes: 0 };
    t.count += 1;
    t.minutes += durationMinutes(r) ?? 0;
    map.set(key(r), t);
  }
  return [...map.entries()].sort(
    (a, b) => b[1].minutes - a[1].minutes || a[0].localeCompare(b[0]),
  );
}

const STYLE = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 16px; }
h1 { font-size: 15pt; margin: 0 0 4px; }
h2 { font-size: 12pt; margin: 18px 0 6px; }
p.meta { margin: 0 0 12px; color: #333; }
p.hint { background: #eef4ff; border: 1px solid #b9cdf5; padding: 8px 10px; border-radius: 6px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #eee; }
td.num { text-align: right; white-space: nowrap; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.totals { width: auto; min-width: 50%; }
@media print { p.hint { display: none; } body { padding: 0; } }
`;

/** Hash for the page CSP: the only inline content allowed is this style. */
export const REPORT_STYLE_HASH =
  'sha256-' + createHash('sha256').update(STYLE).digest('base64');

export const REPORT_CSP = [
  "default-src 'none'",
  `style-src '${REPORT_STYLE_HASH}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Print-ready A4 page: clean table, totals, no app UI and no scripts. */
export function sessionsReportHtml(
  rows: LogRow[],
  opts: { from: Date; to: Date; filters: string[]; generatedAt: Date },
) {
  const body = rows
    .map((r) => {
      const min = durationMinutes(r);
      return `<tr><td>${esc(r.placeTitle)} <small>(${esc(r.placeCode)})</small></td><td>${esc(r.userName)}</td><td>${formatLocal(r.startedAt)}</td><td>${r.endedAt ? formatLocal(r.endedAt) : ''}</td><td class="num">${formatDuration(min)}</td><td>${esc(remark(r))}</td></tr>`;
    })
    .join('\n');
  const totalTable = (title: string, list: ReturnType<typeof totals>) =>
    `<h2>${title}</h2><table class="totals"><thead><tr><th>${title === 'Підсумок за обладнанням' ? 'Обладнання' : 'Особа'}</th><th>Сеансів</th><th>Годин</th></tr></thead><tbody>${list
      .map(
        ([k, t]) =>
          `<tr><td>${esc(k)}</td><td class="num">${t.count}</td><td class="num">${formatDuration(t.minutes)}</td></tr>`,
      )
      .join('')}</tbody></table>`;
  const totalMin = rows.reduce((s, r) => s + (durationMinutes(r) ?? 0), 0);
  // "to" is exclusive; show the last included moment.
  const lastDay = new Date(opts.to.getTime() - 1);
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>Журнал обладнання ${formatLocal(opts.from).slice(0, 10)} — ${formatLocal(lastDay).slice(0, 10)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Журнал роботи з обладнанням</h1>
<p class="meta">Період: ${formatLocal(opts.from)} — ${formatLocal(lastDay)} (київський час)${opts.filters.length ? ` · ${opts.filters.map(esc).join(' · ')}` : ''}<br>
Сеансів: ${rows.length} · Загальний час: ${formatDuration(totalMin)} · Сформовано ${formatLocal(opts.generatedAt)}</p>
<p class="hint">Щоб роздрукувати або зберегти PDF: Ctrl+P (на телефоні — «Поділитися» → «Друк»). Ця підказка не друкується.</p>
<table>
<thead><tr><th>Обладнання</th><th>Особа</th><th>Початок</th><th>Кінець</th><th>Тривалість</th><th>Примітка</th></tr></thead>
<tbody>
${body || '<tr><td colspan="6">За цей період сеансів немає</td></tr>'}
</tbody>
</table>
${
  rows.length
    ? totalTable(
        'Підсумок за обладнанням',
        totals(rows, (r) => r.placeTitle),
      ) +
      totalTable(
        'Підсумок за особами',
        totals(rows, (r) => r.userName),
      )
    : ''
}
</body>
</html>
`;
}
