import { ApiProperty } from '@nestjs/swagger';

export class OrgSignerDto {
  id: string;
  name: string;

  /** false — blocked: staff should pick another signer. */
  active: boolean;
}

export class OrgSettingsDto {
  /** Document header, printed as stored. */
  institution: string;

  groupName: string;

  /** Default signer of documents; null — not chosen. */
  @ApiProperty({ type: OrgSignerDto, nullable: true })
  signer: OrgSignerDto | null;

  /** Printed under the signature. */
  signerPosition: string;

  updatedAt: Date;
}
