import { ApiOkResponse } from '@nestjs/swagger';
import { TaskDto } from './responses.dto';
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
import type { Response } from 'express';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { contentDisposition } from '../files/content-disposition';
import type { UploadedFileLike } from '../files/file-validation';
import {
  CommentDto,
  CreateTaskDto,
  ListTasksQuery,
  UpdateTaskDto,
} from './dto';
import { TasksService } from './tasks.service';

type Req = { user: { id: string; role: string } };

@Controller('tasks')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  /** Board: all tasks, filter by status or `mine=true`. */
  @Can(Action.TasksRead)
  @ApiOkResponse({ type: [TaskDto] })
  @Get()
  list(@Query() q: ListTasksQuery, @Req() req: Req) {
    return this.tasks.list(q, req.user);
  }

  /** Task with assignees, comments and files. */
  @Can(Action.TasksRead)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(id);
  }

  @Can(Action.TasksCreate)
  @Post()
  create(@Body() dto: CreateTaskDto, @Req() req: Req) {
    return this.tasks.create(dto, req.user);
  }

  @Can(Action.TasksManage)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: Req,
  ) {
    return this.tasks.update(id, dto, req.user);
  }

  /** Only a free task without assignees. */
  @Can(Action.TasksManage)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.remove(id, req.user);
  }

  @Can(Action.TasksTake)
  @Post(':id/take')
  @HttpCode(200)
  take(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.take(id, req.user);
  }

  @Can(Action.TasksWork)
  @Post(':id/leave')
  @HttpCode(200)
  leave(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.leave(id, req.user);
  }

  @Can(Action.TasksWork)
  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.start(id, req.user);
  }

  @Can(Action.TasksWork)
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.submit(id, req.user);
  }

  /** Back to work from review; `body` is the moderator's comment. */
  @Can(Action.TasksAccept)
  @Post(':id/return')
  @HttpCode(200)
  returnForRework(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @Req() req: Req,
  ) {
    return this.tasks.returnForRework(id, dto, req.user);
  }

  /** Accept the task: points are split equally between assignees. */
  @Can(Action.TasksAccept)
  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.accept(id, req.user);
  }

  @Can(Action.TasksComment)
  @Post(':id/comments')
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @Req() req: Req,
  ) {
    return this.tasks.addComment(id, dto, req.user);
  }

  @Can(Action.TasksAttach)
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
    return this.tasks.addFile(id, file, req.user);
  }

  @Can(Action.TasksRead)
  @Get(':id/files/:fileId/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.tasks.downloadFile(id, fileId);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': contentDisposition(file.fileName),
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  /** The uploader or staff. */
  @Can(Action.TasksComment)
  @Delete(':id/files/:fileId')
  removeFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Req,
  ) {
    return this.tasks.removeFile(id, fileId, req.user);
  }
}
