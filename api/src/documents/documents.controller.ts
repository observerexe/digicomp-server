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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import type { UploadedFileLike } from '../files/file-validation';
import {
  AddVersionDto,
  CreateDocDto,
  DownloadQuery,
  ListDocsQuery,
  UpdateDocDto,
} from './dto';
import { DocumentsService } from './documents.service';
import { contentDisposition } from '../files/content-disposition';

type Req = { user: { id: string; role: string } };

const UPLOAD = FileInterceptor('file', {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

@Controller('documents')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Can(Action.DocumentsRead)
  @Get()
  list(@Query() q: ListDocsQuery, @Req() req: Req) {
    return this.docs.list(q, req.user);
  }

  @Can(Action.DocumentsRead)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.docs.get(id, req.user);
  }

  @Can(Action.DocumentsRead)
  @Get(':id/versions')
  versions(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.docs.listVersions(id, req.user);
  }

  @Can(Action.DocumentsRead)
  @Get(':id/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DownloadQuery,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ver, stream } = await this.docs.download(id, q.version, req.user);
    res.set({
      'Content-Type': ver.mimeType,
      'Content-Disposition': contentDisposition(ver.fileName),
      'Content-Length': String(ver.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Can(Action.DocumentsManage)
  @Post()
  @UseInterceptors(UPLOAD)
  create(
    @Body() dto: CreateDocDto,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.docs.create(dto, file, req.user);
  }

  @Can(Action.DocumentsManage)
  @Post(':id/files')
  @UseInterceptors(UPLOAD)
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddVersionDto,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.docs.addVersion(id, dto, file, req.user);
  }

  @Can(Action.DocumentsManage)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocDto,
    @Req() req: Req,
  ) {
    return this.docs.update(id, dto, req.user);
  }

  @Can(Action.DocumentsManage)
  @Delete(':id')
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.docs.archive(id, req.user);
  }
}
