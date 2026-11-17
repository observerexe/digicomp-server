import { ApiBody, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { OkDto } from '../common/responses.dto';
import {
  ArchivedCountDto,
  TaskArchiveDto,
  TaskCommentDto,
  TaskDetailDto,
  TaskDto,
  TaskFileDto,
} from './responses.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { FreezeSignatureDto } from '../paperwork/dto';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { contentDisposition } from '../files/content-disposition';
import type { UploadedFileLike } from '../files/file-validation';
import {
  CancelTaskDto,
  CommentDto,
  ListArchiveQuery,
  ListTasksQuery,
  TakeTaskDto,
} from './dto';
import { TasksService } from './tasks.service';

type Req = { user: { id: string; role: string } };

@Controller('tasks')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  /** Board: tasks not in the archive, filter by status or `mine=true`. */
  @Can(Action.TasksRead)
  @ApiOkResponse({ type: [TaskDto] })
  @Get()
  list(@Query() q: ListTasksQuery, @Req() req: Req) {
    return this.tasks.list(q, req.user);
  }

  /** The archive: search, year of acceptance, choice fields, pages. */
  @Can(Action.TasksRead)
  @ApiOkResponse({ type: TaskArchiveDto })
  @Get('archive')
  listArchive(@Query() q: ListArchiveQuery) {
    return this.tasks.listArchive(q);
  }

  /** «Усі виконані — в архів»: how many went. */
  @Can(Action.TasksArchive)
  @ApiOkResponse({ type: ArchivedCountDto })
  @Post('archive-done')
  @HttpCode(200)
  archiveDone(@Req() req: Req) {
    return this.tasks.archiveDone(req.user);
  }

  /** Task with assignees, comments and files. */
  @Can(Action.TasksRead)
  @ApiOkResponse({ type: TaskDetailDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(id);
  }

  /**
   * Only a free task without assignees and without a document (one with a
   * document is cancelled with it). Tasks are created and changed through
   * documents of the editor.
   */
  @Can(Action.TasksManage)
  @ApiOkResponse({ type: OkDto })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTaskDto,
    @Req() req: Req,
  ) {
    return this.tasks.cancel(id, dto, req.user);
  }

  /** Only a done task. */
  @Can(Action.TasksArchive)
  @ApiOkResponse({ type: TaskDto })
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.archive(id, req.user);
  }

  @Can(Action.TasksArchive)
  @ApiOkResponse({ type: TaskDto })
  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.unarchive(id, req.user);
  }

  @Can(Action.TasksTake)
  @ApiOkResponse({ type: TaskDto })
  @ApiBody({ type: TakeTaskDto, required: false })
  @Post(':id/take')
  @HttpCode(200)
  take(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TakeTaskDto,
    @Req() req: Req,
  ) {
    // Without a body Nest passes undefined (the DTO is still validated when sent).
    return this.tasks.take(id, req.user, dto?.start === true);
  }

  @Can(Action.TasksWork)
  @ApiOkResponse({ type: TaskDto })
  @Post(':id/leave')
  @HttpCode(200)
  leave(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.leave(id, req.user);
  }

  @Can(Action.TasksWork)
  @ApiOkResponse({ type: TaskDto })
  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.start(id, req.user);
  }

  @Can(Action.TasksWork)
  @ApiOkResponse({ type: TaskDto })
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.tasks.submit(id, req.user);
  }

  /** Back to work from review; `body` is the moderator's comment. */
  @Can(Action.TasksAccept)
  @ApiOkResponse({ type: TaskDto })
  @Post(':id/return')
  @HttpCode(200)
  returnForRework(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @Req() req: Req,
  ) {
    return this.tasks.returnForRework(id, dto, req.user);
  }

  /**
   * Accept the task: points are split equally between assignees. Its
   * document freezes itself (see the template) — signed by who accepts where
   * a line awaits them (`strokes`; without — PAPER_SIGNATURE_REQUIRED, the
   * task stays «На перевірці»).
   */
  @Can(Action.TasksAccept)
  @ApiOkResponse({ type: TaskDto })
  @ApiBody({ type: FreezeSignatureDto, required: false })
  @Post(':id/accept')
  @HttpCode(200)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FreezeSignatureDto = {},
    @Req() req: Req,
  ) {
    return this.tasks.accept(id, dto, req.user);
  }

  @Can(Action.TasksComment)
  @ApiCreatedResponse({ type: TaskCommentDto })
  @Post(':id/comments')
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @Req() req: Req,
  ) {
    return this.tasks.addComment(id, dto, req.user);
  }

  @Can(Action.TasksAttach)
  @ApiCreatedResponse({ type: TaskFileDto })
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
  @ApiOkResponse({ type: OkDto })
  @Delete(':id/files/:fileId')
  removeFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Req,
  ) {
    return this.tasks.removeFile(id, fileId, req.user);
  }
}
