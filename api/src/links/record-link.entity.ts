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

/**
 * A link between two records of any types (keys as in the record schemas).
 * `from` is the record whose editor made the link; on pages both sides show
 * it. No foreign keys to the records: modules remove links of a record they
 * delete (removeLinksOf). One pair with one role — once, in either direction
 * (unique expression index, see the migration).
 */
@Entity('record_links')
@Index('UQ_record_links_pair', { synchronize: false })
@Index('IDX_record_links_from', ['fromType', 'fromId'])
@Index('IDX_record_links_to', ['toType', 'toId'])
export class RecordLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'from_type', type: 'varchar', length: 40 })
  fromType: string;

  @Column({ name: 'from_id', type: 'uuid' })
  fromId: string;

  @Column({ name: 'to_type', type: 'varchar', length: 40 })
  toType: string;

  @Column({ name: 'to_id', type: 'uuid' })
  toId: string;

  /** What the link means for the source ('' — just related). */
  @Column({ type: 'varchar', length: 40, default: '' })
  role: string;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
