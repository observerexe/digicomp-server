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

export enum PlaceStatus {
  Active = 'active',
  Maintenance = 'maintenance',
  Archived = 'archived',
}

/** Dictionary whose item keys `places.category` holds. */
export const PLACE_CATEGORY = 'place_category';

@Entity('places')
@Index('UQ_places_code', ['code'], {
  unique: true,
  where: '"purged_at" IS NULL',
})
export class Place {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique among the rows not deleted for good: a purged one frees it. */
  @Column({ type: 'varchar', length: 60 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Item key of the PLACE_CATEGORY dictionary. */
  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  location: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'enum', enum: PlaceStatus, default: PlaceStatus.Active })
  status: PlaceStatus;

  @Column({ name: 'needs_authorization', type: 'boolean', default: true })
  needsAuthorization: boolean;

  @Column({ type: 'boolean', default: true })
  exclusive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

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
   * only the title and the code is left; out of the trash too.
   */
  @Column({ name: 'purged_at', type: 'timestamptz', nullable: true })
  purgedAt: Date | null;
}
