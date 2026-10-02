import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class RequestLineDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;
}

class RequestFieldsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY, { message: 'Needed by must look like 2026-09-29.' })
  neededBy?: string | null;

  @IsOptional()
  @IsIn(['NORMAL', 'URGENT'], { message: 'Priority must be Normal or Urgent.' })
  priority?: 'NORMAL' | 'URGENT';

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'The reason cannot be longer than 1,000 characters.' })
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branchCode?: string;
}

export class CreateRequestDto extends RequestFieldsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => RequestLineDto)
  lines!: RequestLineDto[];
}

export class UpdateRequestDto extends RequestFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the request and try again.' })
  version!: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => RequestLineDto)
  lines?: RequestLineDto[];
}

export class RequestVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the request and try again.' })
  version!: number;
}

export class RejectRequestDto extends RequestVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Add a reason. The requester sees it.' })
  @MaxLength(500, { message: 'The reason cannot be longer than 500 characters.' })
  reason!: string;
}

class SupplierGroupDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick a supplier.' })
  @MaxLength(20)
  supplierCode!: string;

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  lineNos!: number[];
}

/** "Create PO directly": which supplier gets which lines (one draft PO per supplier). */
export class RequestToPoDto extends RequestVersionDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Pick a supplier for the lines.' })
  @ValidateNested({ each: true })
  @Type(() => SupplierGroupDto)
  groups!: SupplierGroupDto[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  warehouseCode?: string;
}

/** "Raise request for selected" on the Demand list. */
export class FromDemandDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Tick at least one line on the demand list.' })
  @ValidateNested({ each: true })
  @Type(() => RequestLineDto)
  lines!: RequestLineDto[];
}

export class RequestListQueryDto extends ListQueryDto {
  /** Text: the requester's name */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  requester?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;
}
