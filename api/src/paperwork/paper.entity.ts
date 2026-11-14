import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import type { PaperContent } from './content';

/** Lifecycle of a document; the same for every document. */
export enum PaperStatus {
  Draft = 'draft',
  Published = 'published',
  Frozen = 'frozen',
  Signed = 'signed',
  Cancelled = 'cancelled',
}

/**
 * Who sees a published document besides its author and staff. A draft is
 * seen only by its author and staff, whatever is set here.
 */
export enum PaperVisibility {
  Author = 'author',
  Members = 'members',
}

/** An editor document: ProseMirror JSON and its state. */
@Entity('papers')
@Index('IDX_papers_author_updated', ['authorId', 'updatedAt'])
@Index('IDX_papers_updated', ['updatedAt'])
export class Paper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** ProseMirror document (`{ type: 'doc', content: [...] }`). */
  @Column({ type: 'jsonb' })
  content: PaperContent;

  @Column({ type: 'enum', enum: PaperStatus, default: PaperStatus.Draft })
  status: PaperStatus;

  @Column({
    type: 'enum',
    enum: PaperVisibility,
    default: PaperVisibility.Author,
  })
  visibility: PaperVisibility;

  /** Grows with every change; a save with an older one is a conflict. */
  @Column({ type: 'int', default: 1 })
  revision: number;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
