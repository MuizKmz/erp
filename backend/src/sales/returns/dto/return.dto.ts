import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ReturnListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  invoice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;
}

export class ReturnInvoiceSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ReturnLineDto {
  @IsUUID('all', { message: 'Pick a line of the invoice.' })
  invoiceLineId!: string;

  @Matches(DECIMAL_4, { message: 'Return now must be a number with up to 4 decimals.' })
  qty!: string;
}

class ReturnFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Return date must look like 2026-09-24.' })
  docDate?: string;

  /** "<warehouse>|<location>" from the return-location options */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  location?: string;

  @IsOptional()
  @IsIn(['CREDIT_NOTE', 'REFUND'])
  creditMethod?: 'CREDIT_NOTE' | 'REFUND';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateReturnDto extends ReturnFieldsDto {
  @IsUUID('all', { message: 'Pick the invoice the goods were billed on.' })
  invoiceId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

export class UpdateReturnDto extends ReturnFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines?: ReturnLineDto[];
}

export class ReturnVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
