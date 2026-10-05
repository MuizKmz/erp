import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['DEPOSIT_PCT', 'PAY_BEFORE_RELEASE'] as const;

export class ProformaListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer?: string;

  /** Sales order number */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  order?: string;

  @IsOptional()
  @IsIn(KINDS)
  request?: (typeof KINDS)[number];
}

class ProformaFieldsDto {
  @IsOptional()
  @IsIn(KINDS, { message: 'Pick deposit % or pay before release.' })
  requestKind?: (typeof KINDS)[number];

  @IsOptional()
  @Matches(PERCENT, { message: 'Deposit % must be a number like 30 or 12.5.' })
  depositPct?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Proforma date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Pay by must look like 2026-10-05.' })
  payBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  attention?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateProformaDto extends ProformaFieldsDto {
  @IsUUID('all', { message: 'Pick a released sales order.' })
  salesOrderId!: string;
}

export class UpdateProformaDto extends ProformaFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ProformaVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
