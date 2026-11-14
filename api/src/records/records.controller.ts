import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import {
  CreateFieldDefDto,
  ReorderFieldDefsDto,
  UpdateFieldDefDto,
} from './dto';
import { RecordFieldsService } from './record-fields.service';
import { FieldDefDto, RecordSchemaDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

@Controller('records')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class RecordsController {
  constructor(private fields: RecordFieldsService) {}

  /** Fields of a record type (extra fields included): what templates may bind to. No record data. */
  @Can(Action.RecordsRead)
  @ApiOkResponse({ type: RecordSchemaDto })
  @Get(':type/schema')
  schema(@Param('type') type: string) {
    return this.fields.schema(type);
  }

  /** Extra fields of an extensible type, archived too, in order. */
  @Can(Action.RecordsRead)
  @ApiOkResponse({ type: [FieldDefDto] })
  @Get(':type/field-defs')
  list(@Param('type') type: string) {
    return this.fields.list(type);
  }

  @Can(Action.RecordsFieldsManage)
  @ApiCreatedResponse({ type: FieldDefDto })
  @Post(':type/field-defs')
  create(
    @Param('type') type: string,
    @Body() dto: CreateFieldDefDto,
    @Req() req: Req,
  ) {
    return this.fields.create(type, dto, req.user);
  }

  @Can(Action.RecordsFieldsManage)
  @ApiOkResponse({ type: [FieldDefDto] })
  @Put(':type/field-defs/order')
  reorder(
    @Param('type') type: string,
    @Body() dto: ReorderFieldDefsDto,
    @Req() req: Req,
  ) {
    return this.fields.reorder(type, dto, req.user);
  }

  @Can(Action.RecordsFieldsManage)
  @ApiOkResponse({ type: FieldDefDto })
  @Patch(':type/field-defs/:key')
  update(
    @Param('type') type: string,
    @Param('key') key: string,
    @Body() dto: UpdateFieldDefDto,
    @Req() req: Req,
  ) {
    return this.fields.update(type, key, dto, req.user);
  }

  /** Only a field without values in records; otherwise archive it. */
  @Can(Action.RecordsFieldsManage)
  @ApiOkResponse({ type: OkDto })
  @Delete(':type/field-defs/:key')
  remove(
    @Param('type') type: string,
    @Param('key') key: string,
    @Req() req: Req,
  ) {
    return this.fields.remove(type, key, req.user);
  }
}
