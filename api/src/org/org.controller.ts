import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { UpdateOrgSettingsDto } from './dto';
import { OrgService } from './org.service';
import { OrgSettingsDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

@Controller('org-settings')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class OrgController {
  constructor(private org: OrgService) {}

  @Can(Action.OrgRead)
  @ApiOkResponse({ type: OrgSettingsDto })
  @Get()
  get() {
    return this.org.get();
  }

  @Can(Action.OrgManage)
  @ApiOkResponse({ type: OrgSettingsDto })
  @Patch()
  update(@Body() dto: UpdateOrgSettingsDto, @Req() req: Req) {
    return this.org.update(dto, req.user);
  }
}
