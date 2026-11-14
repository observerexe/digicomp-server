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
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import { CreatePaperDto, ListPapersQuery, UpdatePaperDto } from './dto';
import { PaperworkService } from './paperwork.service';
import { PaperDto, PaperItemDto, PaperListDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

@Controller('papers')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PaperworkController {
  constructor(private papers: PaperworkService) {}

  @Can(Action.PapersRead)
  @ApiOkResponse({ type: PaperListDto })
  @Get()
  list(@Query() q: ListPapersQuery, @Req() req: Req) {
    return this.papers.list(q, req.user);
  }

  @Can(Action.PapersCreate)
  @ApiCreatedResponse({ type: PaperDto })
  @Post()
  create(@Body() dto: CreatePaperDto, @Req() req: Req) {
    return this.papers.create(dto, req.user);
  }

  @Can(Action.PapersRead)
  @ApiOkResponse({ type: PaperDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.papers.get(id, req.user);
  }

  /** Answers without the content: the client has just sent it. */
  @Can(Action.PapersEdit)
  @ApiOkResponse({ type: PaperItemDto })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaperDto,
    @Req() req: Req,
  ) {
    return this.papers.update(id, dto, req.user);
  }

  @Can(Action.PapersEdit)
  @ApiOkResponse({ type: OkDto })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.papers.remove(id, req.user);
  }
}
