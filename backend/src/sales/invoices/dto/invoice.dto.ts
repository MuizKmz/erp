import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { OrderLineDto } from '../../orders/dto/order.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class InvoiceListQueryDto extends ListQueryDto {
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

export class InvoiceCandidatesQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the customer from Master Data.' })
  @MaxLength(20)
  customerCode!: string;
}

class InvoiceFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Invoice date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerPoRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class OrderInvoiceLineDto {
  @IsUUID('all', { message: 'Pick a line of the sales order.' })
  soLineId!: string;

  @Matches(DECIMAL_4, { message: 'Invoice now must be a number with up to 4 decimals.' })
  qty!: string;
}

/** S18: invoice what was delivered on one sales order. */
export class CreateFromOrderDto extends InvoiceFieldsDto {
  @IsUUID('all', { message: 'Pick a sales order with something to invoice.' })
  salesOrderId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Invoice at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => OrderInvoiceLineDto)
  lines!: OrderInvoiceLineDto[];
}

/** "Blank invoice": a direct invoice with items from Master Data, without a sales order. */
export class CreateDirectInvoiceDto extends InvoiceFieldsDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the customer from Master Data.' })
  @MaxLength(20)
  customerCode!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}

export class InvoiceQtyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lineNo!: number;

  @Matches(DECIMAL_4, { message: 'Invoice now must be a number with up to 4 decimals.' })
  qty!: string;
}

export class UpdateInvoiceDto extends InvoiceFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  /** Invoice from an order: change the quantities only. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceQtyDto)
  quantities?: InvoiceQtyDto[];

  /** Direct invoice: the customer and the lines. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

export class InvoiceVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class InvoiceApprovalDto extends InvoiceVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Type a reason for the approver.' })
  @MaxLength(1000)
  reason!: string;
}
