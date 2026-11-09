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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import {
  CreatePlaceDto,
  EndSessionDto,
  GrantAuthorizationDto,
  ListAuthorizationsQuery,
  ListPlacesQuery,
  ListSessionsQuery,
  StartSessionDto,
  UpdatePlaceDto,
} from './dto';
import { PlacesService } from './places.service';
import { WorkSessionsService } from './work-sessions.service';

type Req = { user: { id: string; role: string } };

@Controller('places')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PlacesController {
  constructor(
    private places: PlacesService,
    private sessions: WorkSessionsService,
  ) {}

  @Can(Action.PlacesRead)
  @Get()
  list(@Query() q: ListPlacesQuery, @Req() req: Req) {
    return this.places.list(q, req.user);
  }

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

  @Can(Action.PlacesRead)
  @Get()
  list(@Query() q: ListSessionsQuery, @Req() req: Req) {
    return this.sessions.list(q, req.user);
  }

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
