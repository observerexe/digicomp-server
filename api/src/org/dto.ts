import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const TEXT = /\S/;

/** Only the given fields change. */
export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(TEXT)
  institution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(TEXT)
  groupName?: string;

  /** An active user; null — no default signer. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  signerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(TEXT)
  signerPosition?: string;
}
