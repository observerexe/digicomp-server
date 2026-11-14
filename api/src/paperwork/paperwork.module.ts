import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { OrgModule } from '../org/org.module';
import { RecordsModule } from '../records/records.module';
import { Paper } from './paper.entity';
import { PaperworkController } from './paperwork.controller';
import { PaperworkService } from './paperwork.service';
import { PaperTemplate, PaperTemplateVersion } from './template.entities';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Editor documents (drafts, revisions, visibility, print) and their templates. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Paper, PaperTemplate, PaperTemplateVersion]),
    AuditModule,
    DictionariesModule,
    OrgModule,
    RecordsModule,
  ],
  // Templates first: `/papers/templates` must not reach `/papers/:id`.
  controllers: [TemplatesController, PaperworkController],
  providers: [PaperworkService, TemplatesService],
  exports: [PaperworkService],
})
export class PaperworkModule implements OnModuleInit {
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private templates: TemplatesService,
  ) {}

  onModuleInit() {
    // A dictionary a published template takes values from stays. Item
    // values come with documents made from templates.
    this.dictionaries.register({
      dictionaries: (m) => this.templates.usedDictionaries(m),
      countItem: () => Promise.resolve(0),
    });
  }
}
