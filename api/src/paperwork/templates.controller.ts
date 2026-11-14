import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  UpdateTemplateVersionDto,
} from './templates.dto';
import {
  TemplateDto,
  TemplateItemDto,
  TemplateVersionDto,
  TemplateVersionItemDto,
} from './templates.responses.dto';
import { TemplatesService } from './templates.service';

type Req = { user: { id: string; role: string } };

/** Registered before PaperworkController: `/papers/templates` is not `/papers/:id`. */
@Controller('papers/templates')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class TemplatesController {
  constructor(private templates: TemplatesService) {}

  /** Staff — every template; members — published ones open to all, not archived. */
  @Can(Action.PaperTemplatesRead)
  @ApiOkResponse({ type: [TemplateItemDto] })
  @Get()
  list(@Req() req: Req) {
    return this.templates.list(req.user);
  }

  /** With an empty draft version 1. */
  @Can(Action.PaperTemplatesManage)
  @ApiCreatedResponse({ type: TemplateDto })
  @Post()
  create(@Body() dto: CreateTemplateDto, @Req() req: Req) {
    return this.templates.create(dto, req.user);
  }

  @Can(Action.PaperTemplatesRead)
  @ApiOkResponse({ type: TemplateDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.templates.get(id, req.user);
  }

  @Can(Action.PaperTemplatesManage)
  @ApiOkResponse({ type: TemplateDto })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @Req() req: Req,
  ) {
    return this.templates.update(id, dto, req.user);
  }

  /** Only a template with no published version. */
  @Can(Action.PaperTemplatesManage)
  @ApiOkResponse({ type: OkDto })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.templates.remove(id, req.user);
  }

  /** The draft version; if there is none, a new one copied from the current version. */
  @Can(Action.PaperTemplatesManage)
  @ApiCreatedResponse({ type: TemplateVersionDto })
  @Post(':id/versions')
  draft(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.draft(id);
  }

  /** Members — only the current version. */
  @Can(Action.PaperTemplatesRead)
  @ApiOkResponse({ type: TemplateVersionDto })
  @Get(':id/versions/:v')
  version(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('v', ParseIntPipe) v: number,
    @Req() req: Req,
  ) {
    return this.templates.version(id, v, req.user);
  }

  /** A draft only; answers without body and fields: the client has just sent them. */
  @Can(Action.PaperTemplatesManage)
  @ApiOkResponse({ type: TemplateVersionItemDto })
  @Patch(':id/versions/:v')
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('v', ParseIntPipe) v: number,
    @Body() dto: UpdateTemplateVersionDto,
  ) {
    return this.templates.saveDraft(id, v, dto);
  }

  /** Throws away a draft version. */
  @Can(Action.PaperTemplatesManage)
  @ApiOkResponse({ type: OkDto })
  @Delete(':id/versions/:v')
  discard(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('v', ParseIntPipe) v: number,
    @Req() req: Req,
  ) {
    return this.templates.discardDraft(id, v, req.user);
  }

  /** Checks fields and bindings against the target's schema; the version never changes after. */
  @Can(Action.PaperTemplatesManage)
  @ApiCreatedResponse({ type: TemplateDto })
  @Post(':id/versions/:v/publish')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('v', ParseIntPipe) v: number,
    @Req() req: Req,
  ) {
    return this.templates.publish(id, v, req.user);
  }
}
