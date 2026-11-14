import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrgSettings } from './org-settings.entity';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

/** Requisites for documents: institution, group, default signer. */
@Module({
  imports: [TypeOrmModule.forFeature([OrgSettings]), AuditModule],
  controllers: [OrgController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
