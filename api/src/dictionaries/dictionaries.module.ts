import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesController } from './dictionaries.controller';
import { DictionariesService } from './dictionaries.service';
import { Dictionary, DictionaryItem } from './dictionary.entities';
import { DictionaryUsageRegistry } from './dictionary-usage';

/** Modules that store item keys import this and register a DictionaryUsage. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Dictionary, DictionaryItem]),
    AuditModule,
  ],
  controllers: [DictionariesController],
  providers: [DictionariesService, DictionaryUsageRegistry],
  exports: [DictionaryUsageRegistry],
})
export class DictionariesModule {}
