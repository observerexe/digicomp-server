import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Place } from '../places/place.entity';
import { User } from '../users/user.entity';

/**
 * Equipment booking. Active bookings of one place never overlap: the database
 * enforces it with an exclusion constraint (btree_gist), so concurrent
 * requests cannot create a double booking.
 */
@Entity('bookings')
@Check(`"ends_at" > "starts_at"`)
@Exclusion(
  'bookings_no_overlap',
  `USING gist ("place_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("cancelled_at" IS NULL)`,
)
@Index(['placeId', 'startsAt'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'place_id' })
  place: Place;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ type: 'varchar', length: 500, default: '' })
  note: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById: string | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 500, default: '' })
  cancelReason: string;
}
