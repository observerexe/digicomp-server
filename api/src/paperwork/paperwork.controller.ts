import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import {
  CancelPaperDto,
  CopyPaperDto,
  CreatePaperDto,
  ListPapersQuery,
  PaperForRecordDto,
  UpdatePaperDto,
} from './dto';
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

  /**
   * A document for a record made before documents (its bound fields from
   * the record), published at once; who may change the record.
   */
  @Can(Action.PapersCreate)
  @ApiCreatedResponse({ type: PaperDto })
  @Post('for-record')
  forRecord(@Body() dto: PaperForRecordDto, @Req() req: Req) {
    return this.papers.forRecord(dto, req.user);
  }

  /** A copy of a document the actor sees: its own draft, same template version. */
  @Can(Action.PapersCreate)
  @ApiCreatedResponse({ type: PaperDto })
  @Post(':id/copy')
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopyPaperDto,
    @Req() req: Req,
  ) {
    return this.papers.copy(id, dto, req.user);
  }

  /** A draft becomes final: a record, a number (see the template). */
  @Can(Action.PapersPublish)
  @ApiOkResponse({ type: PaperDto })
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.papers.publish(id, req.user);
  }

  /** With a reason; the record the document created is taken off too. */
  @Can(Action.PapersCancel)
  @ApiOkResponse({ type: PaperDto })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPaperDto,
    @Req() req: Req,
  ) {
    return this.papers.cancel(id, dto, req.user);
  }

  @Can(Action.PapersRead)
  @ApiOkResponse({ type: PaperDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.papers.get(id, req.user);
  }

  /** Print-ready A4 page (print or save as PDF in the browser); own CSP, no scripts. */
  @Can(Action.PapersRead)
  @ApiProduces('text/html')
  @ApiOkResponse({ description: 'HTML page', schema: { type: 'string' } })
  @Get(':id/print')
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { html, csp } = await this.papers.printHtml(id, req.user);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
    });
    return new StreamableFile(Buffer.from(html, 'utf8'));
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
