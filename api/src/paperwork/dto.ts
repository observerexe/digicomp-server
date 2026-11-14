import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { NOT_BLANK } from '../points/dto';
import { IsPaperContent, type PaperContent } from './content';
import { PaperVisibility } from './paper.entity';

export class CreatePaperDto {
  /** Without a title — «Без назви». */
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  /** ProseMirror document; without it — one empty paragraph. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPaperContent()
  content?: PaperContent;
}

/** Only the given fields change. */
export class UpdatePaperDto {
  /** The revision the change is based on; another one — 409 PAPER_CONFLICT. */
  @IsInt()
  @Min(1)
  revision: number;

  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPaperContent()
  content?: PaperContent;

  /** Staff only. Takes effect once the document is published. */
  @IsOptional()
  @IsEnum(PaperVisibility)
  visibility?: PaperVisibility;
}

export class ListPapersQuery {
  /** `true` — only the actor's own documents (tab «Мої»). */
  @IsOptional()
  @IsIn(['true'])
  mine?: string;

  /** Part of the title. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
