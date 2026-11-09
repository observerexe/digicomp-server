/** Dates and numbers for the UI: Ukrainian, Kyiv time. */
const TZ = 'Europe/Kyiv';

const dayMonth = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', timeZone: TZ });
const dayMonthYear = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const weekday = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', timeZone: TZ });
const year = new Intl.DateTimeFormat('uk-UA', { year: 'numeric', timeZone: TZ });
const monthName = new Intl.DateTimeFormat('uk-UA', { month: 'long', timeZone: TZ });

/** "2 жовт." this year, "2 жовт. 2025 р." for other years. */
export function formatDate(value: string | Date, now = new Date()): string {
  const d = new Date(value);
  return year.format(d) === year.format(now) ? dayMonth.format(d) : dayMonthYear.format(d);
}

/** "вт, 10 лист., 14:00" */
export function formatDateTime(value: string | Date, now = new Date()): string {
  const d = new Date(value);
  return `${weekday.format(d)}, ${formatDate(d, now)}, ${time.format(d)}`;
}

export function formatTime(value: string | Date | number): string {
  return time.format(new Date(value));
}

/** Month name for "місце в листопаді"-style captions: "листопад". */
export function currentMonthName(now = new Date()): string {
  return monthName.format(now);
}

/** Points with a sign; a real minus sign for negative values. */
export function formatPoints(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

/** Up to two initials for an avatar placeholder. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Ukrainian plural: plural(5, ['бал', 'бали', 'балів']) → 'балів'. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** "1:46" — hours and minutes between two moments. */
export function formatDuration(from: string | Date, to: string | Date): string {
  const min = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** "4,2 МБ" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} МБ`;
}
