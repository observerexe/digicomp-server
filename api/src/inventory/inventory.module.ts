import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { Doc } from '../documents/doc.entity';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { InventoryController } from './inventory.controller';
import {
  INVENTORY_CATEGORY,
  InventoryItem,
  InventoryMovement,
} from './inventory.entities';
import { INVENTORY_ITEM_LINKS } from './inventory-item.links';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, InventoryMovement, Doc]),
    AuditModule,
    DictionariesModule,
    LinksModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private links: LinkRegistry,
  ) {}

  onModuleInit() {
    this.dictionaries.registerColumn(
      INVENTORY_CATEGORY,
      InventoryItem,
      'category',
    );
    this.links.register('inventory_item', INVENTORY_ITEM_LINKS);
  }
}
