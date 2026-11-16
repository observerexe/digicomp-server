import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { ArchiveService } from './archive.service';
import { ListArchiveQuery } from './dto';
import { ArchiveListDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

@Controller('archive')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class ArchiveController {
  constructor(private archive: ArchiveService) {}

  @Can(Action.DocumentsRead)
  @ApiOkResponse({ type: ArchiveListDto })
  @Get()
  list(@Query() q: ListArchiveQuery, @Req() req: Req) {
    return this.archive.list(q, req.user);
  }
}
