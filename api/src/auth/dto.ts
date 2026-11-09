import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialty?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken: string;
}

export class OptionalRefreshDto {
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken?: string;
}

/** 6-digit code from the authenticator app. */
export class TwoFactorCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

/** Either a code from the app or a one-time recovery code. */
export class TwoFactorProofDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recoveryCode?: string;
}

export class TwoFactorVerifyDto extends TwoFactorProofDto {
  @IsString()
  @MaxLength(1000)
  challengeToken: string;
}
