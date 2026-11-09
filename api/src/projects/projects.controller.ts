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
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';
import { contentDisposition } from '../files/content-disposition';

type Req = { user: { id: string; role: string } };

@Controller('projects')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Can(Action.ProjectsRead)
  @Get()
  list(@Query() q: ListProjectsQuery) {
    return this.projects.list(q);
  }

  @Can(Action.ProjectsRead)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.projects.get(id, req.user);
  }

  @Can(Action.ProjectsRead)
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.history(id);
  }

  @Can(Action.ProjectsCreate)
  @Post()
  create(@Body() dto: CreateProjectDto, @Req() req: Req) {
    return this.projects.create(dto, req.user);
  }

  @Can(Action.ProjectsUpdate)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: Req,
  ) {
    return this.projects.update(id, dto, req.user);
  }

  @Can(Action.ProjectsManage)
  @Delete(':id')
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.projects.archive(id, req.user);
  }

  @Can(Action.ProjectsUpdate)
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

  @Can(Action.ProjectsRead)
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

  @Can(Action.ProjectsManage)
  @Delete(':id/files/:fileId')
  removeFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Req,
  ) {
    return this.projects.removeFile(id, fileId, req.user);
  }
}
