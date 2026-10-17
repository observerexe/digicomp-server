import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import { mimeForExtension } from './file-validation';
import { StorageService } from './storage.service';

@Controller('files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilesController {
  constructor(private storage: StorageService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get('avatars/:userId')
  async avatar(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    for (const ext of ['png', 'jpg', 'webp']) {
      const rel = `avatars/${userId}.${ext}`;
      if (await this.storage.exists(rel)) {
        res.set({
          'Content-Type': mimeForExtension(ext),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=60',
        });
        return new StreamableFile(this.storage.stream(rel));
      }
    }
    throw new NotFoundException('File not found');
  }
}
