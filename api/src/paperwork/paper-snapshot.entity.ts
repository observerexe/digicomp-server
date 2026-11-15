import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Doc } from '../documents/doc.entity';
import { User } from '../users/user.entity';
import type { FieldValues } from './content';
import { Paper } from './paper.entity';

/**
 * A frozen document: the sheet as printed (HTML of the server's render),
 * its SHA-256 and the values it showed. Only ever added: print and PDF come
 * from here, the QR leads to its hash.
 */
@Entity('paper_snapshots')
@Index('UQ_paper_snapshots_paper_n', ['paperId', 'n'], { unique: true })
export class PaperSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'paper_id', type: 'uuid' })
  paperId: string;

  @ManyToOne(() => Paper, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paper_id' })
  paper?: Paper;

  /** 1, 2, … within the document. */
  @Column({ type: 'int' })
  n: number;

  /** `<main class="paper" data-paper data-snapshot>…</main>`: what is hashed. */
  @Column({ type: 'text' })
  html: string;

  /** Hex SHA-256 of `html`. */
  @Index('UQ_paper_snapshots_sha256', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  /** Values of the fields as the document showed them (record ones included). */
  @Column({ name: 'resolved_values', type: 'jsonb' })
  resolvedValues: FieldValues;

  /**
   * The archive document whose versions are the signed scans of this
   * snapshot; null — none uploaded.
   */
  @Index('UQ_paper_snapshots_archive_doc', { unique: true })
  @Column({ name: 'archive_doc_id', type: 'uuid', nullable: true })
  archiveDocId: string | null;

  @ManyToOne(() => Doc, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'archive_doc_id' })
  archiveDoc?: Doc | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
