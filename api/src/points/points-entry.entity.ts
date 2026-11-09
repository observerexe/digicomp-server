import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum PointsKind {
  /** Accepted task, share of its points. */
  Task = 'task',
  /** Manual award by a moderator (household chores etc.). */
  Manual = 'manual',
  /** Fine from a discipline record (negative amount). */
  Fine = 'fine',
  /** Compensating entry that cancels `reversesId`. */
  Reversal = 'reversal',
}

/**
 * Append-only points ledger. Entries are never updated or deleted:
 * revoking an entry adds a reversal with the opposite amount.
 */
@Entity('points_ledger')
@Unique(['userId', 'taskId'])
export class PointsEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'enum', enum: PointsKind })
  kind: PointsKind;

  @Column()
  reason: string;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  /** Who awarded the entry; null for task points and legacy rows. */
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'reverses_id', type: 'uuid', nullable: true, unique: true })
  reversesId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
