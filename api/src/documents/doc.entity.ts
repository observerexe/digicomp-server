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
import { User } from '../users/user.entity';

export enum AccessScope {
  Members = 'members',
  Supervisors = 'supervisors',
}

/** Dictionary whose item keys `documents.category` holds. */
export const DOCUMENT_CATEGORY = 'document_category';

@Entity('documents')
export class Doc {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Item key of the DOCUMENT_CATEGORY dictionary. */
  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({
    name: 'access_scope',
    type: 'enum',
    enum: AccessScope,
    default: AccessScope.Members,
  })
  accessScope: AccessScope;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  /** In the trash since (trash/): hidden everywhere but the trash. */
  @Index()
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  /** Who moved it to the trash. */
  @Column({ name: 'deleted_by_id', type: 'uuid', nullable: true })
  deletedById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deleted_by_id' })
  deletedBy?: User | null;

  /**
   * Deleted for good but kept for its history (sessions, movements, documents):
   * only the title is left; out of the trash too.
   */
  @Column({ name: 'purged_at', type: 'timestamptz', nullable: true })
  purgedAt: Date | null;
}

@Entity('document_versions')
@Unique(['docId', 'version'])
export class DocVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'doc_id', type: 'uuid' })
  docId: string;

  @ManyToOne(() => Doc, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'doc_id' })
  doc: Doc;

  @Column({ type: 'int' })
  version: number;

  @Column({ name: 'file_name', type: 'varchar', length: 200 })
  fileName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ name: 'stored_name', type: 'varchar', length: 100 })
  storedName: string;

  @Column({ name: 'change_note', type: 'varchar', length: 500, default: '' })
  changeNote: string;

  @Column({ name: 'uploaded_by_id', type: 'uuid' })
  uploadedById: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
