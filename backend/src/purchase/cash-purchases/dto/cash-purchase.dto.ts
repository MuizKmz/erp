import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CashLineDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;

  @Matches(DECIMAL_4, { message: 'Unit price must be a number with up to 4 decimals.' })
  unitPrice!: string;
}

export class CreateCashPurchaseDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the shop or supplier.' })
  @MaxLength(20)
  supplierCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick how it was paid.' })
  @MaxLength(20)
  paymentMethodCode!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Purchase date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  receiptNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => CashLineDto)
  lines!: CashLineDto[];

  /** The receipt photo, uploaded first through /attachments. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class UpdateCashPurchaseDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the cash purchase and try again.' })
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  supplierCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  paymentMethodCode?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Purchase date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  receiptNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => CashLineDto)
  lines?: CashLineDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class CashPurchaseVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the cash purchase and try again.' })
  version!: number;
}

export class CashPurchaseListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  paidBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;
}
