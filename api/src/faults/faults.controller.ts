import {
  Body,
  Controller,
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
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import type { UploadedFileLike } from '../files/file-validation';
import { CloseFaultDto, CreateFaultDto, ListFaultsQuery } from './dto';
import { FAULT_PHOTO_MAX_BYTES, FaultsService } from './faults.service';

type Req = { user: { id: string; role: string } };

@Controller('faults')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class FaultsController {
  constructor(private faults: FaultsService) {}

  @Can(Action.FaultsRead)
  @Get()
  list(@Query() q: ListFaultsQuery) {
    return this.faults.list(q);
  }

  @Can(Action.FaultsRead)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.faults.get(id);
  }

  @Can(Action.FaultsCreate)
  @Post()
  create(@Body() dto: CreateFaultDto, @Req() req: Req) {
    return this.faults.create(dto, req.user);
  }

  /** Photo (png, jpg, webp up to 5 MB, max 3): the reporter or staff. */
  @Can(Action.FaultsAttach)
  @Post(':id/photos')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: FAULT_PHOTO_MAX_BYTES, files: 1 },
    }),
  )
  addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Req,
  ) {
    return this.faults.addPhoto(id, file, req.user);
  }

  @Can(Action.FaultsRead)
  @Get(':id/photos/:photoId')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { photo, stream } = await this.faults.photo(id, photoId);
    res.set({
      'Content-Type': photo.mimeType,
      'Content-Length': String(photo.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    });
    return new StreamableFile(stream);
  }

  @Can(Action.FaultsClose)
  @Post(':id/in-progress')
  @HttpCode(200)
  inProgress(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.faults.inProgress(id, req.user);
  }

  /** Report in progress + equipment on maintenance, in one action. */
  @Can(Action.FaultsClose)
  @Post(':id/maintenance')
  @HttpCode(200)
  maintenance(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.faults.maintenance(id, req.user);
  }

  @Can(Action.FaultsClose)
  @Post(':id/close')
  @HttpCode(200)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseFaultDto,
    @Req() req: Req,
  ) {
    return this.faults.close(id, dto, req.user);
  }
}
