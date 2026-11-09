import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { PlaceStatus } from '../places/place.entity';
import { FaultStatus } from './fault.entities';

export class FaultPlaceDto {
  id: string;
  code?: string;
  title?: string;

  @ApiProperty({ enum: PlaceStatus, enumName: 'PlaceStatus', required: false })
  status?: PlaceStatus;
}

export class FaultDto {
  id: string;
  description: string;

  @ApiProperty({ enum: FaultStatus, enumName: 'FaultStatus' })
  status: FaultStatus;

  /** What was done; filled when closed. */
  resolution: string;

  place: FaultPlaceDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  reporter: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  closedBy: UserRefDto | null;

  @ApiProperty({ type: Date, nullable: true })
  closedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export class FaultListItemDto extends FaultDto {
  photosCount: number;
}

export class FaultListDto {
  @ApiProperty({ type: [FaultListItemDto] })
  items: FaultListItemDto[];

  total: number;
  page: number;
  limit: number;
}

export class FaultPhotoDto {
  id: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: Date;
}

export class FaultDetailDto extends FaultDto {
  /** GET /faults/:id/photos/:photoId */
  @ApiProperty({ type: [FaultPhotoDto] })
  photos: FaultPhotoDto[];
}
