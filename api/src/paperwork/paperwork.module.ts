import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrgModule } from '../org/org.module';
import { Paper } from './paper.entity';
import { PaperworkController } from './paperwork.controller';
import { PaperworkService } from './paperwork.service';

/** Editor documents: drafts, revisions, visibility, print. */
@Module({
  imports: [TypeOrmModule.forFeature([Paper]), AuditModule, OrgModule],
  controllers: [PaperworkController],
  providers: [PaperworkService],
  exports: [PaperworkService],
})
export class PaperworkModule {}
