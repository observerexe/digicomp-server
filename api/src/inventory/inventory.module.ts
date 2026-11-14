import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { Doc } from '../documents/doc.entity';
import { InventoryController } from './inventory.controller';
import {
  INVENTORY_CATEGORY,
  InventoryItem,
  InventoryMovement,
} from './inventory.entities';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, InventoryMovement, Doc]),
    AuditModule,
    DictionariesModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private dictionaries: DictionaryUsageRegistry) {}

  onModuleInit() {
    this.dictionaries.registerColumn(
      INVENTORY_CATEGORY,
      InventoryItem,
      'category',
    );
  }
}
