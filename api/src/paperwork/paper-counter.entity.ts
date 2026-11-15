import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The last number given to documents of a prefix in a year
 * (`ТЗ-2026-014`). Taken with `UPDATE … RETURNING` in the publication's
 * transaction, so two documents never share a number.
 */
@Entity('paper_counters')
export class PaperCounter {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  prefix: string;

  @PrimaryColumn({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  last: number;
}
