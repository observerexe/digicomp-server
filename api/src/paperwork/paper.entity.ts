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
import type { RecordType } from '../records/field-types';
import { User } from '../users/user.entity';
import type { FieldValues, PaperContent } from './content';
// Type only: template.entities imports this file (by name below, no cycle at load).
import type { PaperTemplateVersion } from './template.entities';

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
@Index('IDX_papers_target', ['targetType', 'targetId'])
export class Paper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** `<prefix>-<year>-<n>`, given when published (if the template has a prefix). */
  @Index('UQ_papers_number', { unique: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  number: string | null;

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

  /** The template version the document is made from; null — a free document. */
  @Column({ name: 'template_version_id', type: 'uuid', nullable: true })
  templateVersionId: string | null;

  @ManyToOne('PaperTemplateVersion', {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'template_version_id' })
  templateVersion?: PaperTemplateVersion | null;

  /** Values of the template's fields by key (zones live in `content`). */
  @Column({ type: 'jsonb', default: {} })
  values: FieldValues;

  /**
   * The record the document created (a `creates` template): its type and
   * id. Stays when the record is gone (the document was cancelled).
   */
  @Column({ name: 'target_type', type: 'varchar', length: 40, nullable: true })
  targetType: RecordType | null;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /** Why the document was cancelled. */
  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

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
