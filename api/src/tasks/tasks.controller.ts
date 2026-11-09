import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import { CreateTaskDto, UpdateStatusDto } from './dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Can(Action.TasksRead)
  @Get()
  list() {
    return this.tasks.list();
  }

  @Can(Action.TasksCreate)
  @Post()
  create(@Body() dto: CreateTaskDto, @Req() req: { user: { id: string } }) {
    return this.tasks.create(dto, req.user.id);
  }

  @Can(Action.TasksTake)
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.tasks.setStatus(id, dto, req.user);
  }
}
