import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PALETTE, type PaletteColor } from '../dictionaries/palette';
import { Role } from './user.entity';

export class ListUsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;

  /** Staff: guests too (without it the list is the team). */
  @IsOptional()
  @IsIn(['true'])
  guests?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  /** The account's colour: a name from the palette. */
  @ApiPropertyOptional({ enum: PALETTE, enumName: 'PaletteColor' })
  @IsOptional()
  @IsIn(PALETTE)
  color?: PaletteColor;
}

export class UpdateUserDto extends UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
