import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { RecordsModule } from '../records/records.module';
import { TASK_LINKS } from './task.links';
import { Task, TaskAssignee, TaskComment, TaskFile } from './task.entities';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskAssignee, TaskComment, TaskFile]),
    AuditModule,
    FilesModule,
    RecordsModule,
    LinksModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule implements OnModuleInit {
  constructor(private links: LinkRegistry) {}

  onModuleInit() {
    this.links.register('task', TASK_LINKS);
  }
}
