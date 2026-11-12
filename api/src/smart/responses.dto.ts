// Response shapes of /smart for the OpenAPI document (front types are
// generated from it). The service returns these types.
import { ApiProperty } from '@nestjs/swagger';
import { SmartKind } from './smart-entity.entity';

/** One allowed device with its live state from Home Assistant. */
export class SmartEntityStateDto {
  id: string;

  @ApiProperty({ enum: SmartKind, enumName: 'SmartKind' })
  kind: SmartKind;

  label: string;
  room: string;
  enabled: boolean;

  /** false when HA does not know the device or reports it unavailable. */
  available: boolean;

  /** light: switched on. */
  on?: boolean;

  /** light: brightness in percent, null when off or not dimmable. */
  @ApiProperty({ type: Number, nullable: true, required: false })
  brightness?: number | null;

  /** sensor, binary_sensor: raw HA state (`21.5`, `on`, `off`). */
  value?: string;

  @ApiProperty({ type: String, nullable: true, required: false })
  unit?: string | null;

  /** HA device class (`temperature`, `motion`, `moisture`, `door`…). */
  @ApiProperty({ type: String, nullable: true, required: false })
  deviceClass?: string | null;
}

export class SmartEntityListDto {
  @ApiProperty({ type: [SmartEntityStateDto] })
  items: SmartEntityStateDto[];
}

/** Allowlist row (admin). */
export class SmartAllowedDto {
  id: string;

  /** HA entity id, e.g. `light.workshop`. */
  entityId: string;

  @ApiProperty({ enum: SmartKind, enumName: 'SmartKind' })
  kind: SmartKind;

  label: string;
  room: string;
  enabled: boolean;
}

export class SmartAllowlistDto {
  @ApiProperty({ type: [SmartAllowedDto] })
  items: SmartAllowedDto[];
}

/** A device HA has that is not on the allowlist yet. */
export class SmartDiscoveredDto {
  entityId: string;

  @ApiProperty({ enum: SmartKind, enumName: 'SmartKind' })
  kind: SmartKind;

  /** HA friendly name, or the entity id. */
  name: string;

  state: string;
}

export class SmartDiscoverDto {
  @ApiProperty({ type: [SmartDiscoveredDto] })
  items: SmartDiscoveredDto[];
}

export class SmartStatusDto {
  @ApiProperty({ enum: [true] })
  connected: true;

  @ApiProperty({ type: String, nullable: true })
  version: string | null;

  /** HA location name. */
  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  allowedEntities: number;
}
