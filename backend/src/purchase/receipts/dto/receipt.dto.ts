import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
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
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const CONDITIONS = ['GOOD', 'DAMAGED'] as const;

export class ReceiptLineDto {
  @IsUUID('all', { message: 'PO line not found.' })
  poLineId!: string;

  @Matches(DECIMAL_4, { message: 'Receiving now must be a number with up to 4 decimals.' })
  receivedQty!: string;

  @IsOptional()
  @IsIn(CONDITIONS, { message: 'Condition must be Good or Damaged.' })
  condition?: (typeof CONDITIONS)[number];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(30)
  locationCode?: string | null;
}

class ReceiptFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Received date must look like 2026-09-25.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  supplierDoNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehicleNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  warehouseCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  /** What happens to what did not arrive. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['KEEP_OPEN', 'CANCEL_BALANCE'], { message: 'Pick keep open or cancel the balance.' })
  shortAction?: 'KEEP_OPEN' | 'CANCEL_BALANCE' | null;

  /** DO and pallet photos uploaded first through /attachments. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class CreateReceiptDto extends ReceiptFieldsDto {
  @IsUUID('all', { message: 'Purchase order not found.' })
  poId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'There is nothing to receive on this order.' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

export class UpdateReceiptDto extends ReceiptFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the receipt and try again.' })
  version!: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines?: ReceiptLineDto[];
}

export class ReceiptVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the receipt and try again.' })
  version!: number;
}

export class NewReceiptQueryDto {
  @IsUUID('all', { message: 'Purchase order not found.' })
  poId!: string;
}

export class ReceiptListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;
}
