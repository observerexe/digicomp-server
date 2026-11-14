import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Dictionary } from '../dictionaries/dictionary.entities';
import type { ExtraType, RecordType } from './field-types';

/**
 * An extra field of a record type, added by staff («Налаштування полів»).
 * Values live in the record's `extra` jsonb under `key`.
 */
@Entity('record_field_defs')
@Unique('UQ_record_field_defs_key', ['recordType', 'key'])
// Labels are unique ignoring case within a type: an expression index.
@Index('UQ_record_field_defs_label', { synchronize: false })
export class RecordFieldDef {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'record_type', type: 'varchar', length: 40 })
  recordType: RecordType;

  /** Made from the label once; never changes (templates bind to it). */
  @Column({ type: 'varchar', length: 40 })
  key: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  /** Fixed at creation: stored values must keep matching it. */
  @Column({ type: 'varchar', length: 20 })
  type: ExtraType;

  @Column({ type: 'boolean', default: false })
  required: boolean;

  /** enum, list<enum>: key of the dictionary; fixed at creation. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  dictionary: string | null;

  @ManyToOne(() => Dictionary, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'dictionary', referencedColumnName: 'key' })
  dictionaryRef?: Dictionary;

  /** int, decimal: inclusive bounds. */
  @Column({ type: 'double precision', nullable: true })
  min: number | null;

  @Column({ type: 'double precision', nullable: true })
  max: number | null;

  /** text only. */
  @Column({ name: 'max_length', type: 'int', nullable: true })
  maxLength: number | null;

  /** list<enum> only. */
  @Column({ name: 'max_items', type: 'int', nullable: true })
  maxItems: number | null;

  @Column({ type: 'int' })
  position: number;

  /** Archived fields keep old values but take no new ones. */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
