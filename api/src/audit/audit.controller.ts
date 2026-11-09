import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Can(Action.AuditRead)
  @Get()
  list() {
    return this.audit.list();
  }
}
