/**
 * Wall-clock time in Kyiv, whatever time zone the phone is in: bookings are
 * entered and shown in the lab's local time.
 */
const TZ = 'Europe/Kyiv';
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function fields(ms: number) {
  const o: Record<string, number> = {};
  for (const p of parts.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Kyiv offset from UTC at this moment, in ms (+2 h or +3 h). */
function offset(ms: number): number {
  const f = fields(ms);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
}

/** "2026-11-10" + "14:30" in Kyiv → the moment (correct across DST changes). */
export function kyivToDate(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t);
}

/** The moment as Kyiv date "YYYY-MM-DD" and time "HH:MM". */
export function kyivParts(value: Date | string | number): { date: string; time: string } {
  const f = fields(new Date(value).getTime());
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${f.year}-${p(f.month)}-${p(f.day)}`, time: `${p(f.hour)}:${p(f.minute)}` };
}

/** Calendar arithmetic on "YYYY-MM-DD". */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Kyiv day [start, end) as moments. */
export function kyivDay(date: string): { start: Date; end: Date } {
  return { start: kyivToDate(date, '00:00'), end: kyivToDate(addDays(date, 1), '00:00') };
}
