import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { CURRENCIES } from '../../suppliers/suppliers.rules';
import { PRICE_LIST_CODE } from '../price-lists.rules';

const PRICE = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** One dated price: the item, its unit, the price before or with tax (as the list says) and the day it starts. */
export class PriceRowDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the item.' })
  @MaxLength(30)
  itemCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick the unit.' })
  @MaxLength(10)
  uomCode!: string;

  @Transform(trimmed)
  @Matches(PRICE, { message: 'The price must be an amount with up to 4 decimals.' })
  unitPrice!: string;

  @Matches(DATE_ONLY, { message: 'The start date must look like 2026-11-01.' })
  validFrom!: string;
}

/** What the price list form (C09) saves. `prices` are the rows from today on; earlier prices are history and stay. */
class PriceListFieldsDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the price list a name.' })
  @MaxLength(60)
  name!: string;

  @IsIn(CURRENCIES, { message: 'Pick the currency.' })
  currency!: string;

  /** false = prices exclude tax (C08 "Exclude tax"). */
  @IsBoolean()
  taxInclusive!: boolean;

  @Matches(DATE_ONLY, { message: 'The start date must look like 2026-01-01.' })
  validFrom!: string;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(DATE_ONLY, { message: 'The end date must look like 2026-12-31, or be empty for no end.' })
  validTo?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceRowDto)
  prices!: PriceRowDto[];
}

export class CreatePriceListDto extends PriceListFieldsDto {
  @Transform(upper)
  @Matches(PRICE_LIST_CODE, { message: 'Use capitals, digits and dashes, like STD-2027 (up to 20).' })
  code!: string;

  /** A new list may start inactive while it is prepared. Afterwards Deactivate and Activate change it. */
  @IsBoolean()
  isActive!: boolean;
}

export class UpdatePriceListDto extends PriceListFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class PriceListVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
