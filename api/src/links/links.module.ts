import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { LinkRegistry } from './link-registry';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { RecordLink } from './record-link.entity';

/**
 * Links between records (`record_links`). Modules whose records may be
 * linked import this and register a LinkableType in onModuleInit.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RecordLink]), AuditModule],
  controllers: [LinksController],
  providers: [LinksService, LinkRegistry],
  exports: [LinkRegistry],
})
export class LinksModule {}
