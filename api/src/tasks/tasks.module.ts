import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { Task, TaskAssignee, TaskComment, TaskFile } from './task.entities';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskAssignee, TaskComment, TaskFile]),
    AuditModule,
    FilesModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
