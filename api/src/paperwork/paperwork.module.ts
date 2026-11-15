import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { DocumentsModule } from '../documents/documents.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { OrgModule } from '../org/org.module';
import { RecordsModule } from '../records/records.module';
import { PaperAdapterRegistry } from './adapters';
import { PaperCounter } from './paper-counter.entity';
import { PaperSnapshot } from './paper-snapshot.entity';
import { Paper } from './paper.entity';
import { paperLinks } from './paper.links';
import { PaperworkController } from './paperwork.controller';
import { PaperworkService } from './paperwork.service';
import { PaperTemplate, PaperTemplateVersion } from './template.entities';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Editor documents (drafts, revisions, visibility, print, snapshots) and their templates. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Paper,
      PaperCounter,
      PaperSnapshot,
      PaperTemplate,
      PaperTemplateVersion,
    ]),
    AuditModule,
    DictionariesModule,
    DocumentsModule,
    LinksModule,
    OrgModule,
    RecordsModule,
  ],
  // Templates first: `/papers/templates` must not reach `/papers/:id`.
  controllers: [TemplatesController, PaperworkController],
  providers: [PaperworkService, TemplatesService, PaperAdapterRegistry],
  exports: [PaperworkService, PaperAdapterRegistry],
})
export class PaperworkModule implements OnModuleInit {
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private templates: TemplatesService,
    private papers: PaperworkService,
    private links: LinkRegistry,
    private adapters: PaperAdapterRegistry,
  ) {}

  onModuleInit() {
    // A dictionary a published template takes values from stays; an item
    // a document holds in a field stays too.
    this.dictionaries.register({
      dictionaries: (m) => this.templates.usedDictionaries(m),
      countItem: (d, item, m) => this.papers.countItem(m, d, item),
    });
    this.links.register('paper', paperLinks(this.adapters));
  }
}
