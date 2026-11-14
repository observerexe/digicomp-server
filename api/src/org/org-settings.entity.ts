import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Requisites of the organisation for documents. Exactly one row, id = 1. */
@Entity('org_settings')
@Check('CHK_org_settings_single', '"id" = 1')
export class OrgSettings {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  /** Document header, printed as stored. */
  @Column({ type: 'varchar', length: 200, default: '' })
  institution: string;

  @Column({ name: 'group_name', type: 'varchar', length: 200, default: '' })
  groupName: string;

  /** Default signer; cleared if the user is deleted. */
  @Column({ name: 'signer_id', type: 'uuid', nullable: true })
  signerId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'signer_id' })
  signer?: User | null;

  /** Printed under the signature; independent of the profile position. */
  @Column({
    name: 'signer_position',
    type: 'varchar',
    length: 200,
    default: '',
  })
  signerPosition: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
