import { ApiOkResponse } from '@nestjs/swagger';
import { DisciplineListDto, DisciplineRecordDto } from './responses.dto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { RevokeDto } from '../points/dto';
import { DisciplineService } from './discipline.service';
import { IssueDisciplineDto, ListDisciplineQuery } from './dto';

type Req = { user: { id: string; role: string } };

@Controller('discipline')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class DisciplineController {
  constructor(private discipline: DisciplineService) {}

  /** Own warnings, fines and reprimands; nobody else's. */
  @Can(Action.DisciplineReadOwn)
  @ApiOkResponse({ type: [DisciplineRecordDto] })
  @Get('me')
  mine(@Req() req: Req) {
    return this.discipline.mine(req.user.id);
  }

  /** Discipline table for the control panel (staff). */
  @Can(Action.DisciplineReadAll)
  @ApiOkResponse({ type: DisciplineListDto })
  @Get()
  list(@Query() q: ListDisciplineQuery) {
    return this.discipline.list(q);
  }

  /** Warning, fine (takes points) or reprimand; a moderator not to self. */
  @Can(Action.DisciplineIssue)
  @Post()
  issue(@Body() dto: IssueDisciplineDto, @Req() req: Req) {
    return this.discipline.issue(dto, req.user);
  }

  /** Revoke with a reason; a revoked fine returns the points. */
  @Can(Action.DisciplineRevoke)
  @Post(':id/revoke')
  @HttpCode(200)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeDto,
    @Req() req: Req,
  ) {
    return this.discipline.revoke(id, dto, req.user);
  }
}
