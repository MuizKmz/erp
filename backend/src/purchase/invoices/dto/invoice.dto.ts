import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** What the supplier bills for one PO line. */
export class InvoiceLineDto {
  @IsUUID('all', { message: 'PO line not found.' })
  poLineId!: string;

  @Matches(DECIMAL_4, { message: 'Billed quantity must be a number with up to 4 decimals.' })
  billedQty!: string;

  @Matches(DECIMAL_4, { message: 'Billed unit price must be a number with up to 4 decimals.' })
  billedUnitPrice!: string;
}

class InvoiceFieldsDto {
  /** Tax total on their invoice, when it differs from the worked-out tax (tolerance ± RM 1.00). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONEY, { message: 'Tax must be an amount like 400.00.' })
  billedTax?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  supplierNote?: string;

  /** Their invoice PDF, uploaded first through /attachments. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class CreateInvoiceDto extends InvoiceFieldsDto {
  @IsUUID('all', { message: 'Pick the purchase order.' })
  poId!: string;

  @IsString()
  @IsNotEmpty({ message: "Enter the supplier's invoice number." })
  @MaxLength(50)
  supplierInvoiceNo!: string;

  @Matches(DATE_ONLY, { message: 'Enter the invoice date.' })
  invoiceDate!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'There is nothing to bill on this order.' })
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

export class UpdateInvoiceDto extends InvoiceFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the invoice and try again.' })
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "Enter the supplier's invoice number." })
  @MaxLength(50)
  supplierInvoiceNo?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Invoice date must look like 2026-09-26.' })
  invoiceDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];
}

export class InvoiceVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the invoice and try again.' })
  version!: number;
}

/** FlowP5 step 4: record (as billed when it matches, else only what was received), hold, or accept as billed. */
export class DecideInvoiceDto extends InvoiceVersionDto {
  @IsIn(['record', 'hold', 'acceptAsBilled'], { message: 'Pick what to record.' })
  action!: 'record' | 'hold' | 'acceptAsBilled';

  /** Message to the supplier (template Invoice difference). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** Note to the approver (accept as billed). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class NewInvoiceQueryDto {
  @IsUUID('all', { message: 'Pick the purchase order.' })
  poId!: string;
}

export class BillableOrdersQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the supplier.' })
  @MaxLength(20)
  supplierCode!: string;
}

export class InvoiceListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  supplierInvoiceNo?: string;

  @IsOptional()
  @IsIn(['MATCHED', 'DIFFERENCE', 'NOT_MATCHED', ''])
  match?: string;
}
