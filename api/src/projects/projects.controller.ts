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
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

type Req = { user: { id: string; role: string } };

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get()
  list(@Query() q: ListProjectsQuery) {
    return this.projects.list(q);
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.projects.get(id, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.history(id);
  }

  @Roles('admin', 'coordinator')
  @Post()
  create(@Body() dto: CreateProjectDto, @Req() req: Req) {
    return this.projects.create(dto, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: Req,
  ) {
    return this.projects.update(id, dto, req.user);
  }

  @Roles('admin')
  @Delete(':id')
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.projects.archive(id, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Post(':id/files')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  addFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.projects.addFile(id, file, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id/files/:fileId/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.projects.downloadFile(id, fileId);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': contentDisposition(file.fileName),
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Roles('admin', 'coordinator')
  @Delete(':id/files/:fileId')
  removeFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Req,
  ) {
    return this.projects.removeFile(id, fileId, req.user);
  }
}
