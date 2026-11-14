import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import type { PaperContent } from './content';
import { PaperStatus, PaperVisibility } from './paper.entity';

/** A document without its content (lists, the answer to a save). */
export class PaperItemDto {
  id: string;
  title: string;

  @ApiProperty({ enum: PaperStatus, enumName: 'PaperStatus' })
  status: PaperStatus;

  @ApiProperty({ enum: PaperVisibility, enumName: 'PaperVisibility' })
  visibility: PaperVisibility;

  author: UserRefDto;

  /** Send it with the next change (PATCH). */
  revision: number;

  createdAt: Date;
  updatedAt: Date;
}

export class PaperDto extends PaperItemDto {
  /** ProseMirror document. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  content: PaperContent;

  /** The actor may change and delete it: their own draft (admin — any). */
  canEdit: boolean;
}

export class PaperListDto {
  @ApiProperty({ type: [PaperItemDto] })
  items: PaperItemDto[];

  total: number;
  page: number;
  limit: number;
}
