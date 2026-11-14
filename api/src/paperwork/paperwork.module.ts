import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Paper } from './paper.entity';
import { PaperworkController } from './paperwork.controller';
import { PaperworkService } from './paperwork.service';

/** Editor documents: drafts, revisions, visibility. */
@Module({
  imports: [TypeOrmModule.forFeature([Paper]), AuditModule],
  controllers: [PaperworkController],
  providers: [PaperworkService],
  exports: [PaperworkService],
})
export class PaperworkModule {}
