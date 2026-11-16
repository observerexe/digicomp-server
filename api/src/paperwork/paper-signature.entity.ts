import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { PaperSnapshot } from './paper-snapshot.entity';
import type { Strokes } from './signatures';

/**
 * A drawn signature on a line of a snapshot (its `signers`): by the person
 * the line awaits, once. Only ever added — a mistake is the document's
 * cancellation. The snapshot and its hash stay as they are: the print shows
 * signatures over the sheet.
 */
@Entity('paper_signatures')
@Index('UQ_paper_signatures_snapshot_row', ['snapshotId', 'row'], {
  unique: true,
})
export class PaperSignature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @ManyToOne(() => PaperSnapshot, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot?: PaperSnapshot;

  /** The line's index in the snapshot's `signers` (from 0). */
  @Column({ type: 'int' })
  row: number;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** The drawing: strokes of points on a 1500 × 500 field (see signatures.ts). */
  @Column({ type: 'jsonb' })
  strokes: Strokes;

  @CreateDateColumn({ name: 'signed_at', type: 'timestamptz' })
  signedAt: Date;
}
