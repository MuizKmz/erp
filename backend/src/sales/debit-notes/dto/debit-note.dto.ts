import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { OrderLineDto } from '../../orders/dto/order.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DebitListQueryDto extends ListQueryDto {
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

class DebitFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Debit note date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateDebitDto extends DebitFieldsDto {
  @IsUUID('all', { message: 'Pick the released invoice the charge belongs to.' })
  invoiceId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one charge.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}

export class UpdateDebitDto extends DebitFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsUUID('all', { message: 'Pick the released invoice the charge belongs to.' })
  invoiceId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one charge.' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

export class DebitVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
