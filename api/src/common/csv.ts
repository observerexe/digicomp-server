/** One CSV cell; values starting with =,+,-,@ are prefixed against formula injection. */
export function csvCell(v: unknown) {
  let s =
    v == null
      ? ''
      : v instanceof Date
        ? v.toISOString()
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v as string | number | boolean);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",;\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** CSV with BOM so Excel opens Cyrillic correctly. */
export function toCsv(head: string[], rows: unknown[][]) {
  const lines = rows.map((r) => r.map(csvCell).join(','));
  return '\ufeff' + [head.join(','), ...lines].join('\r\n') + '\r\n';
}
