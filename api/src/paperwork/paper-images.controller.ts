import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCreatedResponse, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import type { UploadedFileLike } from '../files/file-validation';
import {
  PAPER_IMAGE_MAX_BYTES,
  PaperImagesService,
} from './paper-images.service';
import { PaperImageDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

/** «Зображення» of editor documents and templates. */
@Controller('paper-images')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PaperImagesController {
  constructor(private images: PaperImagesService) {}

  /**
   * A PNG or JPEG (checked by content) up to 5 MB and 2000 px a side. It
   * goes into a document by its id; none holds it a day later — deleted.
   */
  @Can(Action.PaperImagesUpload)
  @ApiCreatedResponse({ type: PaperImageDto })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PAPER_IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  upload(@UploadedFile() file: UploadedFileLike | undefined, @Req() req: Req) {
    return this.images.upload(file, req.user);
  }

  /** The image: its uploader, or who sees a document or template holding it; never changes. */
  @Can(Action.PaperImagesRead)
  @ApiProduces('image/png', 'image/jpeg')
  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { image, stream } = await this.images.open(id, req.user);
    res.set({
      'Content-Type': image.mimeType,
      'Content-Length': String(image.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    return new StreamableFile(stream);
  }
}
