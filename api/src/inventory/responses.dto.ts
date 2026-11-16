import { ApiProperty } from '@nestjs/swagger';
import { RecordPaperDto } from '../paperwork/responses.dto';

export class InventoryItemDto {
  id: string;

  /** QR code of the item, upper case. */
  code: string;

  title: string;
  category: string;
  quantity: number;

  /** шт, уп and pcs take whole numbers only. */
  unit: string;

  minQuantity: number;

  /** quantity ≤ minQuantity (when a minimum is set). */
  lowStock: boolean;

  location: string;
  notes: string;

  @ApiProperty({ type: String, nullable: true })
  createdById: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export class InventoryItemListDto {
  @ApiProperty({ type: [InventoryItemDto] })
  items: InventoryItemDto[];

  total: number;
  page: number;
  limit: number;
}

export class MovementItemDto {
  id: string;
  code: string;
  title: string;
  unit: string;
}

export class MovementActorDto {
  id: string;
  name?: string;
}

export class InventoryMovementDto {
  id: string;
  itemId: string;

  @ApiProperty({ type: MovementItemDto, required: false })
  item?: MovementItemDto;

  /** Negative — taken, positive — restocked. */
  delta: number;

  quantityAfter: number;
  note: string;

  @ApiProperty({ type: String, nullable: true })
  projectId: string | null;

  /** «Акт списання» that wrote it off (or returned it); null — taken or restocked here. */
  @ApiProperty({ type: RecordPaperDto, nullable: true })
  paper: RecordPaperDto | null;

  actor: MovementActorDto;
  createdAt: Date;
}

export class InventoryMovementListDto {
  @ApiProperty({ type: [InventoryMovementDto] })
  items: InventoryMovementDto[];

  total: number;
  page: number;
  limit: number;
}
