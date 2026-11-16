import { Module } from '@nestjs/common';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';

/** The Archive's search: files of `documents` and frozen editor documents. */
@Module({
  imports: [PaperworkModule],
  controllers: [ArchiveController],
  providers: [ArchiveService],
})
export class ArchiveModule {}
