import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { FilesModule } from '../files/files.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { Doc, DOCUMENT_CATEGORY, DocVersion } from './doc.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DOCUMENT_LINKS } from './document.links';

@Module({
  imports: [
    TypeOrmModule.forFeature([Doc, DocVersion]),
    AuditModule,
    FilesModule,
    DictionariesModule,
    LinksModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule implements OnModuleInit {
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private links: LinkRegistry,
  ) {}

  onModuleInit() {
    this.dictionaries.registerColumn(DOCUMENT_CATEGORY, Doc, 'category');
    this.links.register('document', DOCUMENT_LINKS);
  }
}
