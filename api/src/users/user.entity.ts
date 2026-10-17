import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum Role {
  Admin = 'admin',
  Coordinator = 'coordinator',
  Member = 'member',
  Guest = 'guest',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: Role, default: Role.Member })
  role: Role;

  @Column({ type: 'varchar', length: 100, default: '' })
  position: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  specialty: string;

  @Column({ type: 'text', default: '' })
  bio: string;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
