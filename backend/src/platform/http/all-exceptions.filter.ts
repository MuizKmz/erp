import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

interface ErrorBody {
  code?: string;
  message: string;
  errors?: { field: string; message: string }[];
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  503: 'UNAVAILABLE',
};

/**
 * One response shape for every error:
 * - 400 { message, errors: [{ field, message }] }
 * - 409 { code, message } for broken business rules
 * - others { code, message }
 * Unexpected errors are logged with their stack and shown to the user as a plain sentence.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      this.logger.error(
        `${req.method ?? ''} ${req.url ?? ''} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, body: this.normaliseHttpBody(status, exception.getResponse()) };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: 409, body: { code: 'DUPLICATE', message: 'This record already exists.' } };
        case 'P2025':
          return { status: 404, body: { code: 'NOT_FOUND', message: 'Record not found.' } };
        case 'P2034':
          return {
            status: 409,
            body: { code: 'CONFLICT_RETRY', message: 'Another change happened at the same time. Please try again.' },
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: { code: 'DB_UNAVAILABLE', message: 'The database cannot be reached. Please try again shortly.' },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL', message: 'Something went wrong. Please try again or tell the administrator.' },
    };
  }

  private normaliseHttpBody(status: number, response: string | object): ErrorBody {
    const fallbackCode = DEFAULT_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'ERROR');

    if (typeof response === 'string') {
      return { code: fallbackCode, message: response };
    }

    const raw = response as { code?: unknown; message?: unknown; errors?: unknown };

    // Our own errors already carry the final shape.
    if (Array.isArray(raw.errors)) {
      return { message: String(raw.message ?? 'Please check the highlighted fields.'), errors: raw.errors };
    }

    // Nest built-ins: { statusCode, message, error }. Multer's size limit arrives as 413 "File too large".
    let message = Array.isArray(raw.message) ? raw.message.join(' ') : String(raw.message ?? 'Request failed.');
    if (status === 413) message = 'The file is too large.';
    if (status === 404 && message.startsWith('Cannot ')) message = 'This address does not exist in the API.';

    return { code: typeof raw.code === 'string' ? raw.code : fallbackCode, message };
  }
}
