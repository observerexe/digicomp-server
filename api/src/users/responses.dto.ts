import { ApiProperty } from '@nestjs/swagger';
import { Role } from './user.entity';

/** Public card: what every member sees about another one. */
export class UserPublicDto {
  id: string;
  name: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;

  position: string;
  specialty: string;
  bio: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;
}

/** Staff view: public card plus account fields. */
export class UserExtendedDto extends UserPublicDto {
  email: string;
  active: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

/** Own profile (/auth/me): with the role-layer permissions for the UI. */
export class MeDto extends UserPublicDto {
  email: string;
  active: boolean;
  twoFactorEnabled: boolean;

  /** Actions allowed by the role (docs/PLAN.md); the API checks the rest. */
  permissions: string[];
}

/** List item: extended fields are present for staff only. */
export class UserListItemDto extends UserPublicDto {
  email?: string;
  active?: boolean;
  twoFactorEnabled?: boolean;
  createdAt?: Date;
}

export class UserListDto {
  @ApiProperty({ type: [UserListItemDto] })
  items: UserListItemDto[];

  total: number;
  page: number;
  limit: number;
}

export class UserDetailDto extends UserListItemDto {
  /** Sum of the points ledger (all time). */
  pointsTotal: number;
}

export class AvatarDto {
  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;
}
