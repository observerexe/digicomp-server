import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Paper } from './paper.entity';
import { PaperTemplateVersion } from './template.entities';

/**
 * «Зображення» of editor documents and templates: a PNG or JPEG in the
 * storage (`paper-images/<id>.png|jpg`), never overwritten — a snapshot
 * that refers to it by id stays what it was. Not a file of the Archive and
 * not in the trash: who sees it follows the documents that hold it
 * (paper_image_uses); one no document holds goes a day after its upload.
 */
@Entity('paper_images')
export class PaperImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `image/png` or `image/jpeg`. */
  @Column({ name: 'mime_type', type: 'varchar', length: 20 })
  mimeType: string;

  /** Pixels, from the file's header. */
  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  /** Bytes. */
  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ name: 'uploaded_by_id', type: 'uuid' })
  uploadedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy?: User;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * An image held by a document or by a version of a template (exactly one
 * of them). A draft's set follows its content; a document past its draft
 * only gains images (its snapshots refer to the old ones). Deleting the
 * document or the version deletes its rows; an image held anywhere is not
 * deleted.
 */
@Entity('paper_image_uses')
@Check(
  'CHK_paper_image_uses_owner',
  'num_nonnulls("paper_id", "template_version_id") = 1',
)
@Index('UQ_paper_image_uses_paper', ['imageId', 'paperId'], { unique: true })
@Index('UQ_paper_image_uses_version', ['imageId', 'templateVersionId'], {
  unique: true,
})
export class PaperImageUse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'image_id', type: 'uuid' })
  imageId: string;

  @ManyToOne(() => PaperImage, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'image_id' })
  image?: PaperImage;

  @Index()
  @Column({ name: 'paper_id', type: 'uuid', nullable: true })
  paperId: string | null;

  @ManyToOne(() => Paper, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paper_id' })
  paper?: Paper;

  @Index()
  @Column({ name: 'template_version_id', type: 'uuid', nullable: true })
  templateVersionId: string | null;

  @ManyToOne(() => PaperTemplateVersion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_version_id' })
  templateVersion?: PaperTemplateVersion;
}
