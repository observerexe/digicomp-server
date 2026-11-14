import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { FilesModule } from '../files/files.module';
import { Place } from '../places/place.entity';
import { Doc, DOCUMENT_CATEGORY, DocVersion } from './doc.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Doc, DocVersion, Place]),
    AuditModule,
    FilesModule,
    DictionariesModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule implements OnModuleInit {
  constructor(private dictionaries: DictionaryUsageRegistry) {}

  onModuleInit() {
    this.dictionaries.registerColumn(DOCUMENT_CATEGORY, Doc, 'category');
  }
}
