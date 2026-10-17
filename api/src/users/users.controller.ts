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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { UploadedFileLike } from '../files/file-validation';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import {
  ChangePasswordDto,
  ListUsersQuery,
  ResetPasswordDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto';
import { UsersService } from './users.service';

type Req = { user: { id: string; role: string } };

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get()
  list(@Query() q: ListUsersQuery, @Req() req: Req) {
    return this.users.list(q, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Patch('me')
  updateMe(@Body() dto: UpdateProfileDto, @Req() req: Req) {
    return this.users.updateProfile(req.user.id, dto);
  }

  @Roles('admin', 'coordinator', 'member')
  @Patch('me/password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Req) {
    return this.users.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.users.get(id, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Post(':id/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  setAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.users.setAvatar(id, file, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Delete(':id/avatar')
  removeAvatar(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.users.removeAvatar(id, req.user);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Req,
  ) {
    return this.users.update(id, dto, req.user);
  }

  @Roles('admin')
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: Req,
  ) {
    return this.users.resetPassword(id, dto.newPassword, req.user);
  }
}
