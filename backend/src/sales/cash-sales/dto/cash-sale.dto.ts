import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { OrderLineDto } from '../../orders/dto/order.dto';

const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['CASH', 'CARD', 'DUITNOW', 'TRANSFER'] as const;

export class CashListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  buyer?: string;

  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  counter?: string;
}

export class CashSaleDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Sale date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  buyerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  buyerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  buyerTin?: string;

  @IsOptional()
  @IsBoolean()
  ownEInvoice?: boolean;

  @IsOptional()
  @IsIn(METHODS, { message: 'Pick how the customer pays.' })
  paymentMethod?: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  paymentRef?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'Amount received must look like 550.00.' })
  amountReceived?: string;

  /** Prices include tax (tax mode Inclusive). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

export class UpdateCashSaleDto extends CashSaleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CashVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
