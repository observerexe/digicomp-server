import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { recordSchema } from './records.registry';
import { RecordSchemaDto } from './responses.dto';

@Controller('records')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class RecordsController {
  /** Fields of a record type: what templates may bind to. No record data. */
  @Can(Action.RecordsRead)
  @ApiOkResponse({ type: RecordSchemaDto })
  @Get(':type/schema')
  schema(@Param('type') type: string) {
    return recordSchema(type);
  }
}
