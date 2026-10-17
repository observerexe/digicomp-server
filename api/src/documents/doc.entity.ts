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
import { Place } from '../places/place.entity';

export enum AccessScope {
  Members = 'members',
  Supervisors = 'supervisors',
}

@Entity('documents')
export class Doc {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
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

  @Column({ name: 'place_id', type: 'uuid', nullable: true })
  placeId: string | null;

  @ManyToOne(() => Place, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'place_id' })
  place: Place | null;

  @Column({ name: 'inventory_item_id', type: 'uuid', nullable: true })
  inventoryItemId: string | null;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
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
