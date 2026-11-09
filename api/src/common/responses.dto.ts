// Shared response shapes for the OpenAPI document (front types are generated
// from it). Services return these types, so the compiler keeps them in sync.
import { ApiProperty } from '@nestjs/swagger';

export class OkDto {
  @ApiProperty({ enum: [true] })
  ok: true;
}

/** Short reference to a user (author, assignee, issuer). */
export class UserRefDto {
  id: string;

  /** null when the user no longer exists. */
  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;
}

export class PlaceRefDto {
  id: string;
  code: string;
  title: string;
}

/** A DTO as a plain object type (views are spread into other views). */
export type Plain<T> = { [K in keyof T]: T[K] };
