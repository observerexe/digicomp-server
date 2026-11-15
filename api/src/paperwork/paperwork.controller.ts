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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  contentDisposition,
  inlineDisposition,
  PDF_PREVIEW_HEADERS,
} from '../files/content-disposition';
import type { UploadedFileLike } from '../files/file-validation';
import {
  CancelPaperDto,
  CopyPaperDto,
  CreatePaperDto,
  ListPapersQuery,
  PaperForRecordDto,
  PaperScanQuery,
  PrintPaperQuery,
  UpdatePaperDto,
} from './dto';
import { PaperworkService } from './paperwork.service';
import {
  PaperDto,
  PaperItemDto,
  PaperListDto,
  PaperVerifyDto,
} from './responses.dto';

type Req = { user: { id: string; role: string } };

const SCAN_UPLOAD = FileInterceptor('file', {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

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

  /**
   * Freezes for print and signature: a snapshot of the sheet with its
   * SHA-256; once the records are ready (a member — own free document).
   */
  @Can(Action.PapersFreeze)
  @ApiOkResponse({ type: PaperDto })
  @Post(':id/freeze')
  @HttpCode(200)
  freeze(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.papers.freeze(id, req.user);
  }

  /**
   * The signed scan of a frozen document (PDF or a photo): a version in the
   * Archive; the document becomes «Підписано». Again — the next version.
   */
  @Can(Action.PapersSign)
  @ApiOkResponse({ type: PaperDto })
  @Post(':id/signed')
  @HttpCode(200)
  @UseInterceptors(SCAN_UPLOAD)
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.papers.sign(id, file, req.user);
  }

  /** The latest signed scan, for who sees the document; `inline=1` — a PDF opens in the browser. */
  @Can(Action.PapersRead)
  @Get(':id/signed')
  async scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaperScanQuery,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ver, stream } = await this.papers.scan(id, req.user);
    const preview = q.inline === '1' && ver.mimeType === 'application/pdf';
    res.set({
      'Content-Type': ver.mimeType,
      'Content-Disposition': preview
        ? inlineDisposition(ver.fileName)
        : contentDisposition(ver.fileName),
      ...(preview ? PDF_PREVIEW_HEADERS : {}),
      'Content-Length': String(ver.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  /** The check of a printed document by its hash (the QR of its seal). */
  @Can(Action.PapersRead)
  @ApiOkResponse({ type: PaperVerifyDto })
  @Get('verify/:sha')
  verify(@Param('sha') sha: string, @Req() req: Req) {
    return this.papers.verify(sha, req.user);
  }

  @Can(Action.PapersRead)
  @ApiOkResponse({ type: PaperDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.papers.get(id, req.user);
  }

  /**
   * Print-ready A4 page (print or save as PDF in the browser); own CSP, no
   * scripts. Frozen — a snapshot with its seal; otherwise marked as not final.
   */
  @Can(Action.PapersRead)
  @ApiProduces('text/html')
  @ApiOkResponse({ description: 'HTML page', schema: { type: 'string' } })
  @Get(':id/print')
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PrintPaperQuery,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { html, csp } = await this.papers.printHtml(id, q, req.user);
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
