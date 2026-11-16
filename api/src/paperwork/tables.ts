import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Actor } from '../auth/policy';
import type { FieldType } from '../records/field-types';
import { RECORD_ID, type AutoTableData } from '../../../shared/editor-schema';

export type { AutoTableData, AutoTables } from '../../../shared/editor-schema';
export { tableKey } from '../../../shared/editor-schema';

/** The shape of a value of each type a source may take. */
const INPUT_SHAPE: Partial<Record<string, RegExp>> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
};
const shapeOf = (input: string) =>
  input.startsWith('ref:') ? RECORD_ID : INPUT_SHAPE[input];

/** Rows an auto table shows at most: the latest ones; the rest — «і ще N». */
export const TABLE_MAX_ROWS = 200;

/** What a source gives for one value of its field. */
export type TableRows = {
  /** Text cells, as many as the source's columns, oldest first. */
  rows: string[][];
  /** Rows left out over TABLE_MAX_ROWS (the oldest). */
  more?: number;
  /** Above the table (the month of a ranking). */
  caption?: string | null;
};

/**
 * A source of «Авто-таблиця»: a module tells the editor what rows it has
 * for a value of a field (equipment, a day of a month). The editor knows no
 * sections: a module registers it in onModuleInit.
 */
export type TableSource = {
  /** In the constructor: «Журнал сеансів». */
  label: string;
  /** The type of the field it takes (`ref:place`, `date`). */
  input: FieldType;
  columns: string[];
  /**
   * Rows for the value, as `reader` may see them (the module's own rule:
   * a member — only their own sessions); `m` — the caller's transaction.
   */
  rows(value: string, reader: Actor, m: EntityManager): Promise<TableRows>;
};

@Injectable()
export class PaperTableRegistry {
  private sources = new Map<string, TableSource>();

  register(key: string, source: TableSource) {
    this.sources.set(key, source);
  }

  get(key: string): TableSource | undefined {
    return this.sources.get(key);
  }

  /** Sources by key, sorted. */
  entries(): [string, TableSource][] {
    return [...this.sources].sort(([a], [b]) => a.localeCompare(b));
  }

  /** The type of field each source takes. */
  inputs(): Map<string, string> {
    return new Map([...this.sources].map(([k, s]) => [k, s.input]));
  }

  /**
   * What a source shows for a value (null — the field is empty: no rows
   * yet); null — no such source.
   */
  async data(
    key: string,
    value: unknown,
    reader: Actor,
    m: EntityManager,
  ): Promise<AutoTableData | null> {
    const s = this.sources.get(key);
    if (!s) return null;
    if (typeof value !== 'string' || value === '') {
      return { columns: s.columns, caption: null, rows: null, more: 0 };
    }
    // Values are checked when saved; one of another shape has no rows.
    const r: TableRows = shapeOf(s.input)?.test(value)
      ? await s.rows(value, reader, m)
      : { rows: [] };
    return {
      columns: s.columns,
      caption: r.caption ?? null,
      rows: r.rows,
      more: r.more ?? 0,
    };
  }
}
