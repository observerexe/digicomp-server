import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum Role {
  Admin = 'admin',
  Moderator = 'moderator',
  Member = 'member',
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

  // --- Two-factor authentication (TOTP). Never returned by the API. ---

  /** Encrypted with TOTP_KEY; set on setup, active once totpEnabledAt is set. */
  @Column({ name: 'totp_secret_enc', type: 'text', nullable: true })
  totpSecretEnc: string | null;

  @Column({ name: 'totp_enabled_at', type: 'timestamptz', nullable: true })
  totpEnabledAt: Date | null;

  /** Last accepted time step: a code cannot be used twice. */
  @Column({ name: 'totp_last_step', type: 'int', nullable: true })
  totpLastStep: number | null;

  @Column({ name: 'totp_failed_attempts', type: 'int', default: 0 })
  totpFailedAttempts: number;

  @Column({ name: 'totp_locked_until', type: 'timestamptz', nullable: true })
  totpLockedUntil: Date | null;

  /** argon2 hashes of unused recovery codes. */
  @Column({
    name: 'recovery_codes',
    type: 'jsonb',
    default: () => "'[]'",
  })
  recoveryCodes: string[];
}
