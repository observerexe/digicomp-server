import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { PointsModule } from '../points/points.module';
import { User } from '../users/user.entity';
import { disciplineAdapter } from './discipline-record.adapter';
import { DisciplineController } from './discipline.controller';
import { DisciplineRecord } from './discipline.entity';
import { DISCIPLINE_LINKS } from './discipline.links';
import { DisciplineService } from './discipline.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DisciplineRecord, User]),
    AuditModule,
    LinksModule,
    PaperworkModule,
    PointsModule,
  ],
  controllers: [DisciplineController],
  providers: [DisciplineService],
})
export class DisciplineModule implements OnModuleInit {
  constructor(
    private links: LinkRegistry,
    private papers: PaperAdapterRegistry,
    private discipline: DisciplineService,
  ) {}

  onModuleInit() {
    this.links.register('discipline_record', DISCIPLINE_LINKS);
    this.papers.register(
      'discipline_record',
      disciplineAdapter(this.discipline),
    );
  }
}
