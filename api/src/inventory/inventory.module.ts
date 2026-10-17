import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Doc } from '../documents/doc.entity';
import { InventoryController } from './inventory.controller';
import { InventoryItem, InventoryMovement } from './inventory.entities';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, InventoryMovement, Doc]),
    AuditModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
