import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import {
  BunkerCard,
  BunkerPack,
  BunkerPackCard,
  BunkerRoom,
  BunkerRoomMember,
} from './bunker.entities';
import { BunkerCardsService } from './bunker-cards.service';
import { BunkerController, BunkerRoomsController } from './bunker.controller';
import { BunkerRoomsService } from './bunker-rooms.service';

/** «Розваги» → «Бункер» (docs/tech/ARCHITECTURE.md). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BunkerCard,
      BunkerPack,
      BunkerPackCard,
      BunkerRoom,
      BunkerRoomMember,
    ]),
    AuditModule,
  ],
  controllers: [BunkerController, BunkerRoomsController],
  providers: [BunkerCardsService, BunkerRoomsService],
})
export class BunkerModule {}
