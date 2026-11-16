import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { PaperTableRegistry } from '../paperwork/tables';
import { TrashRegistry } from '../trash/trash-registry';
import { TrashModule } from '../trash/trash.module';
import { inventoryItemTrash } from './inventory-item.trash';
import { InventoryController } from './inventory.controller';
import {
  INVENTORY_CATEGORY,
  InventoryItem,
  InventoryMovement,
} from './inventory.entities';
import { INVENTORY_ITEM_LINKS } from './inventory-item.links';
import { inventoryWriteOffAdapter } from './inventory-writeoff.adapter';
import { InventoryService } from './inventory.service';
import { PROJECT_MATERIALS } from './inventory.tables';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, InventoryMovement]),
    AuditModule,
    DictionariesModule,
    LinksModule,
    PaperworkModule,
    TrashModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private links: LinkRegistry,
    private papers: PaperAdapterRegistry,
    private inventory: InventoryService,
    private tables: PaperTableRegistry,
    private trash: TrashRegistry,
  ) {}

  onModuleInit() {
    this.dictionaries.registerColumn(
      INVENTORY_CATEGORY,
      InventoryItem,
      'category',
    );
    this.links.register('inventory_item', INVENTORY_ITEM_LINKS);
    this.trash.register('inventory_item', inventoryItemTrash(this.inventory));
    this.papers.register(
      'inventory_writeoff',
      inventoryWriteOffAdapter(this.inventory),
    );
    this.tables.register('project_materials', PROJECT_MATERIALS);
  }
}
