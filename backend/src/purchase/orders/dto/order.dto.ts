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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

/** Quantities and prices travel as strings with up to 4 decimals: "95", "40.00", "21.6". */
const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const PO_TYPES = ['STD', 'BTO', 'SVC', 'AST'] as const;

export class OrderLineDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;

  @Matches(DECIMAL_4, { message: 'Unit price must be a number with up to 4 decimals.' })
  unitPrice!: string;

  /** Leave out to use the item's purchase tax code from Master Data. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxCode?: string;
}

class OrderFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'PO date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY, { message: 'Expected delivery must look like 2026-09-29.' })
  expectedDate?: string | null;

  @IsOptional()
  @IsIn(PO_TYPES, { message: 'PO type must be STD, BTO, SVC or AST.' })
  poTypeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Supplier quote ref cannot be longer than 50 characters.' })
  supplierQuoteRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Note to supplier cannot be longer than 2,000 characters.' })
  noteToSupplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class CreateOrderDto extends OrderFieldsDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick a supplier.' })
  @MaxLength(20)
  supplierCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick where the goods are delivered.' })
  @MaxLength(20)
  warehouseCode!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}

/**
 * Drafts: any field. Released orders: only expectedDate, promisedDate and supplierSays (the delivery promise).
 * `version` must be the one the user loaded (optimistic lock).
 */
export class UpdateOrderDto extends OrderFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the order and try again.' })
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  supplierCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  warehouseCode?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY, { message: 'Promised date must look like 2026-09-29.' })
  promisedDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  supplierSays?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

export class VersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the order and try again.' })
  version!: number;
}

export class SubmitOrderDto extends VersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'The note cannot be longer than 1,000 characters.' })
  note?: string;

  /** The first approver, when the user picks someone else with the same role. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  approverCode?: string;
}

export class OrderListQueryDto extends ListQueryDto {
  /** Text: supplier code or name */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  /** Buyer user code */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  buyer?: string;

  /** Branch code */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;
}
