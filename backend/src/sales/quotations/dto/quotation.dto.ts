import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { OrderLineDto } from '../../orders/dto/order.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class QuotationListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  agent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;
}

class QuotationFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Quotation date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Valid until must look like 2026-10-13.' })
  validUntil?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customerNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNote?: string;
}

export class CreateQuotationDto extends QuotationFieldsDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the customer from Master Data.' })
  @MaxLength(20)
  customerCode!: string;

  @IsOptional()
  @IsUUID()
  enquiryId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}

export class UpdateQuotationDto extends QuotationFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

export class QuotationVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class DiscountApprovalDto extends QuotationVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Type a reason for the approver.' })
  @MaxLength(1000)
  reason!: string;
}

export class LostDto extends QuotationVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Say why the customer did not go ahead.' })
  @MaxLength(200)
  reason!: string;
}

export class TransferDto extends QuotationVersionDto {
  /** Line numbers to copy; all lines when left out. */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  lineNos?: number[];
}
