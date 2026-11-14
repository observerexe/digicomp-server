import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { RecordFieldDef } from './record-field-def.entity';
import { RecordFieldsService } from './record-fields.service';
import { RecordsController } from './records.controller';

/**
 * Record schemas (records.registry.ts) and extra fields of record types.
 * Modules with an extensible type check `extra` via RecordFieldsService.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RecordFieldDef]),
    AuditModule,
    DictionariesModule,
  ],
  controllers: [RecordsController],
  providers: [RecordFieldsService],
  exports: [RecordFieldsService],
})
export class RecordsModule implements OnModuleInit {
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private fields: RecordFieldsService,
  ) {}

  onModuleInit() {
    // Dictionaries of extra fields stay; their items in `extra` stay too.
    this.dictionaries.register({
      dictionaries: (m) => this.fields.usedDictionaries(m),
      countItem: (d, item, m) => this.fields.countItem(m, d, item),
    });
  }
}
