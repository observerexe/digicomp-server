import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Roles('admin')
  @Get()
  list() {
    return this.audit.list();
  }
}
