import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import {
  DomainError,
  EntityNotFoundError,
  EntityConflictError,
  InsufficientStockError,
  ForbiddenOperationError,
  InvalidOperationError,
} from '../errors/domain.errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        message = (exceptionResponse as any).message || exception.message;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof DomainError) {
      if (exception instanceof EntityNotFoundError) {
        status = HttpStatus.NOT_FOUND;
      } else if (exception instanceof EntityConflictError) {
        status = HttpStatus.CONFLICT;
      } else if (exception instanceof ForbiddenOperationError) {
        status = HttpStatus.FORBIDDEN;
      } else if (
        exception instanceof InsufficientStockError ||
        exception instanceof InvalidOperationError
      ) {
        status = HttpStatus.BAD_REQUEST;
      } else {
        status = HttpStatus.BAD_REQUEST; // Default domain error
      }
      message = exception.message;
    } else if (exception instanceof Error) {
      // Handle Drizzle or Database errors specifically if needed
      if ('code' in exception) {
        const anyEx = exception as any;
        if (anyEx.code === '23505') {
          // Postgres Unique Violation
          status = HttpStatus.CONFLICT;
          message = 'Resource already exists.';
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }
      this.logger.error(
        `Unhandled Exception: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(`Unknown Exception: ${exception}`);
    }

    response.status(status).send({
      success: false,
      error: {
        message,
        ...(process.env.NODE_ENV !== 'production' && {
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      },
    });
  }
}
