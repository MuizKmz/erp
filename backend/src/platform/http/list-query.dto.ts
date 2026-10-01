import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Query for every list endpoint: ?page=1&pageSize=20&status=&q=&dateFrom=&dateTo=&sort=-docDate */
export class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number.' })
  @Min(1, { message: 'Page must be 1 or more.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page size must be a whole number.' })
  @Min(1, { message: 'Page size must be 1 or more.' })
  @Max(100, { message: 'Page size cannot be more than 100.' })
  pageSize: number = 20;

  /** Status tab, in lower camel case as in statusCounts: draft, pendingApproval … ("all" or empty = no filter). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Search text cannot be longer than 100 characters.' })
  q?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'From date must look like 2026-09-29.' })
  dateFrom?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'To date must look like 2026-09-29.' })
  dateTo?: string;

  /** Field name, "-" in front for descending: -docDate */
  @IsOptional()
  @Matches(/^-?[A-Za-z][A-Za-z0-9]*$/, { message: 'Sort must be a field name, with "-" in front for descending.' })
  sort?: string;
}
