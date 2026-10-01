import { HttpException, HttpStatus } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

/** 400 — the request is incomplete or malformed. Body: { message, errors: [{ field, message }] }. */
export class ValidationFailedError extends HttpException {
  constructor(errors: FieldError[], message = 'Please check the highlighted fields.') {
    super({ message, errors }, HttpStatus.BAD_REQUEST);
  }

  static field(field: string, message: string): ValidationFailedError {
    return new ValidationFailedError([{ field, message }], message);
  }
}

/**
 * 409 — a business rule refused the action. Body: { code, message }.
 * The message is shown to the user as-is, so name the limit:
 * "Receiving now cannot be more than the open quantity (5)."
 */
export class BusinessRuleError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super({ code, message }, HttpStatus.CONFLICT);
  }
}

/** 409 — the document changed since the user loaded it (optimistic lock on `version`). */
export class StaleVersionError extends BusinessRuleError {
  constructor() {
    super('STALE_VERSION', 'Someone else changed this document. Reload it and try again.');
  }
}

/** 404 — absent, or belongs to another tenant (deliberately indistinguishable). */
export class NotFoundError extends HttpException {
  constructor(what = 'Record') {
    super({ code: 'NOT_FOUND', message: `${what} not found.` }, HttpStatus.NOT_FOUND);
  }
}

/** 403 — the user's roles do not include the permission. */
export class PermissionDeniedError extends HttpException {
  constructor(permission: string) {
    super(
      {
        code: 'FORBIDDEN',
        message: `Your role cannot do this. Permission needed: ${permission}.`,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 500 — the system is set up wrongly (e.g. no numbering for a document type). */
export class ConfigurationError extends HttpException {
  constructor(message: string) {
    super({ code: 'CONFIGURATION', message }, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
