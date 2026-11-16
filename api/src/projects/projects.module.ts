import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { User } from '../users/user.entity';
import { PROJECT_LINKS } from './project.links';
import { Project, ProjectFile, ProjectMember } from './project.entities';
import { PROJECT_READER } from './project.reader';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, ProjectMember, ProjectFile, User]),
    AuditModule,
    FilesModule,
    LinksModule,
    PaperworkModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule implements OnModuleInit {
  constructor(
    private links: LinkRegistry,
    private papers: PaperAdapterRegistry,
  ) {}

  onModuleInit() {
    this.links.register('project', PROJECT_LINKS);
    this.papers.registerReader('project', PROJECT_READER);
  }
}
