import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorSetupDto {
  /** Base32 secret for manual entry in the authenticator app. */
  secret: string;

  /** otpauth:// link to show as a QR code. */
  otpauthUri: string;
}

export class RecoveryCodesDto {
  /** Shown once; only hashes are stored. */
  @ApiProperty({ type: [String] })
  recoveryCodes: string[];
}
