import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { PaletteColor } from './palette';

/** A list of values (task types, categories…) managed by staff, not code. */
@Entity('dictionaries')
// Titles are unique ignoring case: an expression index made by the migration.
@Index('UQ_dictionaries_title', { synchronize: false })
export class Dictionary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Never changes: modules and templates refer to the dictionary by key. */
  @Column({ type: 'varchar', length: 40, unique: true })
  key: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @OneToMany(() => DictionaryItem, (i) => i.dictionary)
  items?: DictionaryItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('dictionary_items')
@Unique('UQ_dictionary_items_key', ['dictionaryId', 'key'])
@Index('UQ_dictionary_items_title', { synchronize: false })
export class DictionaryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dictionary_id', type: 'uuid' })
  dictionaryId: string;

  @ManyToOne(() => Dictionary, (d) => d.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'dictionary_id' })
  dictionary?: Dictionary;

  /** Stored in records instead of the title; never changes. */
  @Column({ type: 'varchar', length: 40 })
  key: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  /** A name from the palette in docs/design/tokens.json. */
  @Column({ type: 'varchar', length: 16, default: 'gray' })
  color: PaletteColor;

  @Column({ type: 'int' })
  position: number;

  /** Archived items stay valid in old records but are not offered anymore. */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
