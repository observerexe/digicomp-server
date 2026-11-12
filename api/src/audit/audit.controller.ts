import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import { AuditService } from './audit.service';
import { ListAuditQuery } from './dto';
import { AuditEntryDto } from './responses.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  /** Newest first; `before` + `limit` page through, filters narrow down. */
  @Can(Action.AuditRead)
  @ApiOkResponse({ type: [AuditEntryDto] })
  @Get()
  list(@Query() q: ListAuditQuery) {
    return this.audit.list(q);
  }
}
