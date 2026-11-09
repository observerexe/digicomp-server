import { ApiProperty } from '@nestjs/swagger';
import { AccessScope } from './doc.entity';

export class DocDto {
  id: string;
  title: string;
  category: string;
  description: string;

  @ApiProperty({ enum: AccessScope, enumName: 'AccessScope' })
  accessScope: AccessScope;

  @ApiProperty({ type: String, nullable: true })
  placeId: string | null;

  @ApiProperty({ type: String, nullable: true })
  inventoryItemId: string | null;

  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  archived: boolean;

  /** Latest version; null for a document without files. */
  @ApiProperty({ type: Number, nullable: true })
  version: number | null;

  @ApiProperty({ type: String, nullable: true })
  fileName: string | null;

  @ApiProperty({ type: String, nullable: true })
  mimeType: string | null;

  @ApiProperty({ type: Number, nullable: true })
  size: number | null;

  versionsCount: number;
}

export class DocListDto {
  @ApiProperty({ type: [DocDto] })
  items: DocDto[];

  total: number;
  page: number;
  limit: number;
}

export class DocVersionDto {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  changeNote: string;
  uploadedById: string;
  createdAt: Date;
}
