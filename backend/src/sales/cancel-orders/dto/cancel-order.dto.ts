import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { CANCEL_REASONS } from '../cancel-order.rules';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CancelListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  order?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;
}

export class CancelLineDto {
  @IsUUID('all', { message: 'Pick a line of the sales order.' })
  soLineId!: string;

  @Matches(DECIMAL_4, { message: 'Cancel now must be a number with up to 4 decimals.' })
  qty!: string;
}

class CancelFieldsDto {
  @IsOptional()
  @IsIn(CANCEL_REASONS, { message: 'Pick a reason from the list.' })
  reason?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Cancel date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  askedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateCancelDto extends CancelFieldsDto {
  @IsUUID('all', { message: 'Pick the sales order to cancel.' })
  salesOrderId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CancelLineDto)
  lines!: CancelLineDto[];
}

export class UpdateCancelDto extends CancelFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelLineDto)
  lines?: CancelLineDto[];
}

export class CancelVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
