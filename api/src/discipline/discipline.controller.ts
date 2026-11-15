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
import { ListDisciplineQuery } from './dto';

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
    return this.discipline.mine(req.user);
  }

  /** Discipline table for the control panel (staff). */
  @Can(Action.DisciplineReadAll)
  @ApiOkResponse({ type: DisciplineListDto })
  @Get()
  list(@Query() q: ListDisciplineQuery, @Req() req: Req) {
    return this.discipline.list(q, req.user);
  }

  /**
   * Revoke a record made before documents, with a reason; a revoked fine
   * returns the points. Issued through a document («Подання про
   * стягнення») — only by cancelling it: 409 DISCIPLINE_HAS_PAPER.
   */
  @ApiOkResponse({ type: DisciplineRecordDto })
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
