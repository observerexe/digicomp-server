import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { TrashController } from './trash.controller';
import { TrashRegistry } from './trash-registry';
import { TrashService } from './trash.service';

/**
 * The trash. Modules whose records may be deleted import this, register a
 * TrashableType in onModuleInit and call TrashService.delete from their
 * DELETE.
 */
@Module({
  imports: [AuditModule, FilesModule],
  controllers: [TrashController],
  providers: [TrashService, TrashRegistry],
  exports: [TrashService, TrashRegistry],
})
export class TrashModule {}
