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
import { Place } from '../places/place.entity';
import { User } from '../users/user.entity';

export enum FaultStatus {
  Open = 'open',
  InProgress = 'in_progress',
  Closed = 'closed',
}

@Entity('fault_reports')
@Index(['placeId', 'status'])
export class FaultReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'place_id' })
  place: Place;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_id' })
  reporter: User;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: FaultStatus, default: FaultStatus.Open })
  status: FaultStatus;

  @Column({ type: 'text', default: '' })
  resolution: string;

  @Column({ name: 'closed_by_id', type: 'uuid', nullable: true })
  closedById: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('fault_photos')
export class FaultPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'fault_id', type: 'uuid' })
  faultId: string;

  @ManyToOne(() => FaultReport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fault_id' })
  fault: FaultReport;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ name: 'stored_name', type: 'varchar', length: 100 })
  storedName: string;

  @Column({ name: 'uploaded_by_id', type: 'uuid' })
  uploadedById: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
