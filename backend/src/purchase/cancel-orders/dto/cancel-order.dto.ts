import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CancelLineDto {
  @IsUUID('all', { message: 'PO line not found.' })
  poLineId!: string;

  @Matches(DECIMAL_4, { message: 'Cancel quantity must be a number with up to 4 decimals.' })
  cancelQty!: string;
}

export class CreateCancelOrderDto {
  @IsUUID('all', { message: 'Pick the purchase order.' })
  poId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick a reason.' })
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Cancel date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'There is nothing open to cancel on this order.' })
  @ValidateNested({ each: true })
  @Type(() => CancelLineDto)
  lines!: CancelLineDto[];

  /** The supplier's letter and other files, uploaded first through /attachments. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class UpdateCancelOrderDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the cancellation and try again.' })
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Pick a reason.' })
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Cancel date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CancelLineDto)
  lines?: CancelLineDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class CancelOrderVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the cancellation and try again.' })
  version!: number;
}

export class NewCancelOrderQueryDto {
  @IsUUID('all', { message: 'Pick the purchase order.' })
  poId!: string;
}

export class CancelOrderListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  poNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
