import { ApiProperty } from '@nestjs/swagger';

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
  documentsCount: number;

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

export class ItemDocRefDto {
  id: string;
  title: string;
  category: string;
}

export class InventoryItemDetailDto extends InventoryItemDto {
  @ApiProperty({ type: [ItemDocRefDto] })
  documents: ItemDocRefDto[];
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
