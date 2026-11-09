import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  AuthorizationDto,
  PlaceDto,
  RecentSessionDto,
  WorkSessionDto,
  WorkSessionListDto,
} from './responses.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import {
  CreatePlaceDto,
  EndSessionDto,
  ExportSessionsQuery,
  GrantAuthorizationDto,
  ListAuthorizationsQuery,
  ListPlacesQuery,
  ListSessionsQuery,
  StartSessionDto,
  UpdatePlaceDto,
} from './dto';
import { PlacesService } from './places.service';
import { REPORT_CSP } from './session-log';
import { WorkSessionsService } from './work-sessions.service';

type Req = { user: { id: string; role: string } };

@Controller('places')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PlacesController {
  constructor(
    private places: PlacesService,
    private sessions: WorkSessionsService,
  ) {}

  @ApiOkResponse({ type: [PlaceDto] })
  @Can(Action.PlacesRead)
  @Get()
  list(@Query() q: ListPlacesQuery, @Req() req: Req) {
    return this.places.list(q, req.user);
  }

  @ApiOkResponse({ type: PlaceDto })
  @Can(Action.PlacesRead)
  @Get(':id')
  get(@Param('id') id: string, @Req() req: Req) {
    return this.places.get(id, req.user);
  }

  @Can(Action.PlacesManage)
  @Post()
  create(@Body() dto: CreatePlaceDto, @Req() req: Req) {
    return this.places.create(dto, req.user);
  }

  @Can(Action.PlacesManage)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePlaceDto,
    @Req() req: Req,
  ) {
    return this.places.update(id, dto, req.user);
  }

  /** Last 10 sessions for everyone (who, when, how long; no notes). */
  @ApiOkResponse({ type: [RecentSessionDto] })
  @Can(Action.PlacesRead)
  @Get(':id/sessions/recent')
  recent(@Param('id') id: string, @Req() req: Req) {
    return this.sessions.recent(id, req.user);
  }

  @ApiCreatedResponse({ type: WorkSessionDto })
  @Can(Action.SessionsStart)
  @Post(':id/sessions')
  start(
    @Param('id') id: string,
    @Body() dto: StartSessionDto,
    @Req() req: Req,
  ) {
    return this.sessions.start(id, dto, req.user);
  }
}

@Controller('work-sessions')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class WorkSessionsController {
  constructor(private sessions: WorkSessionsService) {}

  @ApiOkResponse({ type: WorkSessionListDto })
  @Can(Action.PlacesRead)
  @Get()
  list(@Query() q: ListSessionsQuery, @Req() req: Req) {
    return this.sessions.list(q, req.user);
  }

  /** Equipment log as CSV (Excel), period [from, to), default current month. */
  @Can(Action.SessionsExport)
  @Get('export.csv')
  async exportCsv(
    @Query() q: ExportSessionsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.sessions.exportCsv(q);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="equipment-log.csv"',
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  /** Print-ready A4 page of the log (print or save as PDF in the browser). */
  @Can(Action.SessionsExport)
  @Get('report')
  async report(
    @Query() q: ExportSessionsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const html = await this.sessions.reportHtml(q);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': REPORT_CSP,
    });
    return new StreamableFile(Buffer.from(html, 'utf8'));
  }

  @ApiOkResponse({ type: WorkSessionDto })
  @Can(Action.SessionsStart)
  @Patch(':id/end')
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndSessionDto,
    @Req() req: Req,
  ) {
    return this.sessions.end(id, dto, req.user);
  }
}

@Controller('place-authorizations')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class AuthorizationsController {
  constructor(private places: PlacesService) {}

  @ApiOkResponse({ type: [AuthorizationDto] })
  @Can(Action.PlacesRead)
  @Get()
  list(@Query() q: ListAuthorizationsQuery, @Req() req: Req) {
    return this.places.listAuthorizations(q, req.user);
  }

  @Can(Action.PlacesAuthorize)
  @Post()
  grant(@Body() dto: GrantAuthorizationDto, @Req() req: Req) {
    return this.places.grant(dto, req.user);
  }

  @Can(Action.PlacesAuthorize)
  @Delete(':id')
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.places.revoke(id, req.user);
  }
}
