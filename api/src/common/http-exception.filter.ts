import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

const MESSAGE_CODES: Record<string, string> = {
  'Invalid credentials': 'INVALID_CREDENTIALS',
  'Invalid refresh token': 'INVALID_REFRESH_TOKEN',
  'Invalid current password': 'INVALID_CURRENT_PASSWORD',
  'Setup already completed': 'SETUP_ALREADY_COMPLETED',
  'Email already used': 'EMAIL_TAKEN',
  'Cannot remove the last active admin': 'LAST_ADMIN',
  'Not allowed': 'NOT_ALLOWED',
  'Unknown assignee': 'UNKNOWN_ASSIGNEE',
  'Task already completed': 'TASK_ALREADY_COMPLETED',
  'Not your task': 'NOT_YOUR_TASK',
  'Only admin can confirm completion': 'ADMIN_ONLY_CONFIRM',
  'Place is in use': 'PLACE_IN_USE',
  'Place is not available': 'PLACE_UNAVAILABLE',
  'Place code already used': 'PLACE_CODE_TAKEN',
  'Not authorized for this place': 'NOT_AUTHORIZED_FOR_PLACE',
  'You already have an active session': 'ACTIVE_SESSION_EXISTS',
  'Session already ended': 'SESSION_ALREADY_ENDED',
  'Not your session': 'NOT_YOUR_SESSION',
  'Safety confirmation required': 'SAFETY_CONFIRMATION_REQUIRED',
  'Reason is required to end another user session': 'REASON_REQUIRED',
  'Unknown place': 'UNKNOWN_PLACE',
  'File is required': 'FILE_REQUIRED',
  'File type is not allowed': 'FILE_TYPE_NOT_ALLOWED',
  'File content does not match its type': 'FILE_CONTENT_MISMATCH',
  'File too large': 'FILE_TOO_LARGE',
  'Insufficient stock': 'INSUFFICIENT_STOCK',
  'Item code already used': 'ITEM_CODE_TAKEN',
  'Delta must not be zero': 'DELTA_ZERO',
  'Delta must be an integer for this unit': 'INTEGER_REQUIRED',
  'Quantity must be an integer for this unit': 'INTEGER_REQUIRED',
  'Note is required': 'NOTE_REQUIRED',
  'Only admin or coordinator can receive stock': 'STOCK_RECEIVE_FORBIDDEN',
  'Only admin or coordinator can change members': 'PROJECT_MEMBERS_FORBIDDEN',
  'No rights to edit this project': 'PROJECT_EDIT_FORBIDDEN',
  'Unknown or inactive member': 'UNKNOWN_MEMBER',
  'Smart home is not configured': 'SMART_NOT_CONFIGURED',
  'Smart home is unavailable': 'SMART_UNAVAILABLE',
  'Smart home rejected the access token': 'SMART_AUTH_FAILED',
  'Unknown Home Assistant entity': 'UNKNOWN_HA_ENTITY',
  'Entity kind does not match': 'ENTITY_KIND_MISMATCH',
  'Entity already added': 'SMART_ENTITY_EXISTS',
  'Device is not available': 'DEVICE_UNAVAILABLE',
  'Brightness requires on=true': 'BRIGHTNESS_REQUIRES_ON',
};

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export function codeFor(status: number, message: unknown) {
  if (typeof message === 'string') {
    if (MESSAGE_CODES[message]) return MESSAGE_CODES[message];
    const nf = /^(.+) not found$/.exec(message);
    if (nf) {
      return nf[1].toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_NOT_FOUND';
    }
  }
  return STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const body: Record<string, unknown> =
        typeof raw === 'string' ? { message: raw } : { ...(raw as object) };
      body.statusCode = status;
      body.errorCode = body.errorCode ?? codeFor(status, body.message);
      if (status >= 500) this.logger.error(String(exception.message));
      return res.status(status).json(body);
    }

    const err = exception as {
      code?: string;
      driverError?: { code?: string };
      stack?: string;
    };
    const pg = err?.driverError?.code ?? err?.code;
    if (pg === '23505' || pg === '23503' || pg === '23514') {
      return res.status(409).json({
        statusCode: 409,
        errorCode: pg === '23505' ? 'CONFLICT' : 'CONSTRAINT_VIOLATION',
        message: 'Conflict',
      });
    }
    if (pg === '22P02') {
      return res.status(400).json({
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'Invalid value',
      });
    }
    this.logger.error(err?.stack ?? String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      errorCode: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}
