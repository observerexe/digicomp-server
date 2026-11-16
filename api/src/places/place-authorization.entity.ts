import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Paper } from '../paperwork/paper.entity';
import { User } from '../users/user.entity';
import { Place } from './place.entity';

@Entity('place_authorizations')
@Unique(['userId', 'placeId'])
export class PlaceAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'place_id' })
  place: Place;

  @Column({ name: 'granted_by_id', type: 'uuid' })
  grantedById: string;

  /** When the current term was granted: a repeat briefing renews it. */
  @Column({ name: 'granted_at', type: 'timestamptz', default: () => 'now()' })
  grantedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  note: string;

  /**
   * The document («Запис про інструктаж і допуск») that granted the
   * current term; null — granted before documents. A repeat briefing
   * renews the same row and its document becomes this one. Published
   * documents are never deleted.
   */
  @Index()
  @Column({ name: 'paper_id', type: 'uuid', nullable: true })
  paperId: string | null;

  @ManyToOne(() => Paper, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paper_id' })
  paper?: Paper;
}
