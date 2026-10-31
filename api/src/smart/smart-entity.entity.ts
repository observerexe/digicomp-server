import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SmartKind {
  Light = 'light',
  Sensor = 'sensor',
  Scene = 'scene',
}

@Entity('smart_entities')
export class SmartEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 120, unique: true })
  entityId: string;

  @Column({ type: 'enum', enum: SmartKind })
  kind: SmartKind;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  room: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
