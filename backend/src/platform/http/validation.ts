import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { ValidationFailedError, type FieldError } from './errors';

/**
 * Turns class-validator's nested errors into a flat list with readable paths:
 * lines → 0 → qty becomes "lines[0].qty".
 */
export function flattenValidationErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const isIndex = /^\d+$/.test(error.property);
    const path = isIndex
      ? `${parentPath}[${error.property}]`
      : parentPath
        ? `${parentPath}.${error.property}`
        : error.property;

    for (const message of Object.values(error.constraints ?? {})) {
      result.push({ field: path, message });
    }
    if (error.children?.length) {
      result.push(...flattenValidationErrors(error.children, path));
    }
  }
  return result;
}

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedError(flattenValidationErrors(errors)),
  });
}
