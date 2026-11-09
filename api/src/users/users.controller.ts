import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { OkDto } from '../common/responses.dto';
import { AvatarDto, MeDto, UserDetailDto, UserListDto } from './responses.dto';
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
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
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
@UseGuards(JwtAuthGuard, PolicyGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Can(Action.UsersRead)
  @ApiOkResponse({ type: UserListDto })
  @Get()
  list(@Query() q: ListUsersQuery, @Req() req: Req) {
    return this.users.list(q, req.user);
  }

  @Can(Action.ProfileEditOwnBio)
  @ApiOkResponse({ type: MeDto })
  @Patch('me')
  updateMe(@Body() dto: UpdateProfileDto, @Req() req: Req) {
    return this.users.updateProfile(req.user, dto);
  }

  @Can(Action.ProfileChangePassword)
  @ApiOkResponse({ type: OkDto })
  @Patch('me/password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Req) {
    return this.users.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Can(Action.UsersRead)
  @ApiOkResponse({ type: UserDetailDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.users.get(id, req.user);
  }

  @Can(Action.ProfileEditOwnAvatar)
  @ApiCreatedResponse({ type: AvatarDto })
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

  @Can(Action.ProfileEditOwnAvatar)
  @ApiOkResponse({ type: AvatarDto })
  @Delete(':id/avatar')
  removeAvatar(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.users.removeAvatar(id, req.user);
  }

  @Can(Action.UsersManage)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Req,
  ) {
    return this.users.update(id, dto, req.user);
  }

  @Can(Action.UsersResetPassword)
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: Req,
  ) {
    return this.users.resetPassword(id, dto.newPassword, req.user);
  }
}
