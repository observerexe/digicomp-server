import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import { CreateLinkDto, LinkCandidatesQuery, ListLinksQuery } from './dto';
import { LinksService } from './links.service';
import { LinkCandidateDto, LinkDto, LinkListDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

@Controller('links')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class LinksController {
  constructor(private links: LinksService) {}

  /** Links of a record, both directions; only records the caller sees. */
  @Can(Action.LinksRead)
  @ApiOkResponse({ type: LinkListDto })
  @Get()
  list(@Query() q: ListLinksQuery, @Req() req: Req) {
    return this.links.list(q, req.user);
  }

  /** Records of a type the caller sees, by title: what may be linked. */
  @Can(Action.LinksRead)
  @ApiOkResponse({ type: [LinkCandidateDto] })
  @Get('candidates')
  candidates(@Query() q: LinkCandidatesQuery, @Req() req: Req) {
    return this.links.candidates(q, req.user);
  }

  /** Whoever edits the source record; both records must be visible. */
  @Can(Action.LinksManage)
  @ApiCreatedResponse({ type: LinkDto })
  @Post()
  create(@Body() dto: CreateLinkDto, @Req() req: Req) {
    return this.links.create(dto, req.user);
  }

  /** Whoever edits the source record. */
  @Can(Action.LinksManage)
  @ApiOkResponse({ type: OkDto })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.links.remove(id, req.user);
  }
}
