import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { User } from '../users/user.entity';
import { Project, ProjectFile, ProjectMember } from './project.entities';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, ProjectMember, ProjectFile, User]),
    AuditModule,
    FilesModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
