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
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import { CreateTaskDto, UpdateStatusDto } from './dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get()
  list() {
    return this.tasks.list();
  }

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateTaskDto, @Req() req: { user: { id: string } }) {
    return this.tasks.create(dto, req.user.id);
  }

  @Roles('admin', 'coordinator', 'member')
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.tasks.setStatus(id, dto, req.user);
  }
}
