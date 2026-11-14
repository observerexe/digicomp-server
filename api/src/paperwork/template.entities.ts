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
import type { RecordType } from '../records/field-types';
import { User } from '../users/user.entity';
import type { PaperContent } from './content';
import { PaperVisibility } from './paper.entity';
import type { TemplateField } from './template-fields';

/**
 * What a document of the template does when published: creates a record
 * of the target type, reports on one, or is free (no record).
 */
export enum TemplateKind {
  Creates = 'creates',
  Report = 'report',
  Free = 'free',
}

/** Who may create documents from the template. */
export enum TemplateCreators {
  All = 'all',
  Staff = 'staff',
}

/**
 * A template: its versions hold the body and fields; documents are made
 * from the current (last published) one. Kind and target never change:
 * bindings of published versions rely on them.
 */
@Entity('paper_templates')
export class PaperTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'enum', enum: TemplateKind })
  kind: TemplateKind;

  /** Record type of `creates` and `report`; null for `free`. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  target: RecordType | null;

  /** Documents get numbers `<prefix>-<year>-<n>` when published. */
  @Column({
    name: 'number_prefix',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  numberPrefix: string | null;

  /** `creates` only: freeze the document once its record is done. */
  @Column({ name: 'auto_freeze', type: 'boolean', default: false })
  autoFreeze: boolean;

  @Column({
    type: 'enum',
    enum: TemplateCreators,
    default: TemplateCreators.Staff,
  })
  creators: TemplateCreators;

  /** Visibility of new documents (staff may change it on a document). */
  @Column({
    type: 'enum',
    enum: PaperVisibility,
    default: PaperVisibility.Author,
  })
  visibility: PaperVisibility;

  /** The last published version; null until the first is published. */
  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId: string | null;

  @ManyToOne(() => PaperTemplateVersion, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'current_version_id' })
  currentVersion?: PaperTemplateVersion | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * A version of a template. A draft (no `publishedAt`) is edited with
 * revisions; a published one never changes. At most one draft a template.
 */
@Entity('paper_template_versions')
@Unique('UQ_paper_template_versions_number', ['templateId', 'number'])
@Index('UQ_paper_template_versions_draft', ['templateId'], {
  unique: true,
  where: '"published_at" IS NULL',
})
export class PaperTemplateVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @ManyToOne(() => PaperTemplate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template?: PaperTemplate;

  /** 1, 2, 3… within the template. */
  @Column({ type: 'int' })
  number: number;

  /** ProseMirror document of the template. */
  @Column({ type: 'jsonb' })
  body: PaperContent;

  @Column({ type: 'jsonb' })
  fields: TemplateField[];

  /** Version of the target's schema the bindings were checked against. */
  @Column({
    name: 'schema_version',
    type: 'varchar',
    length: 12,
    nullable: true,
  })
  schemaVersion: string | null;

  /** Grows with every save of the draft. */
  @Column({ type: 'int', default: 1 })
  revision: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'published_by_id', type: 'uuid', nullable: true })
  publishedById: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'published_by_id' })
  publishedBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
