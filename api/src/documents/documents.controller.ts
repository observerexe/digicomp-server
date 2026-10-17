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
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import type { UploadedFileLike } from '../files/file-validation';
import {
  AddVersionDto,
  CreateDocDto,
  DownloadQuery,
  ListDocsQuery,
  UpdateDocDto,
} from './dto';
import { DocumentsService } from './documents.service';

type Req = { user: { id: string; role: string } };

const UPLOAD = FileInterceptor('file', {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get()
  list(@Query() q: ListDocsQuery, @Req() req: Req) {
    return this.docs.list(q, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.docs.get(id, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id/versions')
  versions(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.docs.listVersions(id, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
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

  @Roles('admin', 'coordinator')
  @Post()
  @UseInterceptors(UPLOAD)
  create(
    @Body() dto: CreateDocDto,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.docs.create(dto, file, req.user);
  }

  @Roles('admin', 'coordinator')
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

  @Roles('admin', 'coordinator')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocDto,
    @Req() req: Req,
  ) {
    return this.docs.update(id, dto, req.user);
  }

  @Roles('admin')
  @Delete(':id')
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.docs.archive(id, req.user);
  }
}
