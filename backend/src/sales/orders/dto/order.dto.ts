import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class OrderListQueryDto extends ListQueryDto {
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

export class OrderLineDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;

  @Matches(DECIMAL_4, { message: 'Unit price must be a number with up to 4 decimals.' })
  unitPrice!: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'Discount must be a percentage like 5 or 7.5.' })
  discountPct?: string;
}

class OrderFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Order date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Delivery wanted by must look like 2026-10-12.' })
  deliveryWantedBy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerPoRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  project?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  deliveryAddress?: string;

  @IsOptional()
  @IsIn(['STD', 'BTO', 'PRJ'], { message: 'Pick an order type from the list.' })
  orderTypeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class CreateOrderDto extends OrderFieldsDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the customer from Master Data.' })
  @MaxLength(20)
  customerCode!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}

export class UpdateOrderDto extends OrderFieldsDto {
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

export class VersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class RequestApprovalDto extends VersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Type a reason for the approver.' })
  @MaxLength(1000)
  reason!: string;
}
