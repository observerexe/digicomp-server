import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PlaceStatus {
  Active = 'active',
  Maintenance = 'maintenance',
  Archived = 'archived',
}

@Entity('places')
export class Place {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
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
}
