import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum Role {
  Admin = 'admin',
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
