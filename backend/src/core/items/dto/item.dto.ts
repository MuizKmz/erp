import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { ITEM_CODE, ITEM_TYPES, type ItemType } from '../items.rules';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const FACTOR = /^\d{1,12}(\.\d{1,6})?$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class ItemListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  group?: string;

  @IsOptional()
  @IsIn(ITEM_TYPES, { message: 'Unknown item type.' })
  type?: ItemType;

  /** buy = can be bought, sell = can be sold, both = both. */
  @IsOptional()
  @IsIn(['buy', 'sell', 'both'], { message: 'Pick bought, sold or both.' })
  use?: 'buy' | 'sell' | 'both';
}

export class ConversionDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick both units of the conversion.' })
  @MaxLength(10)
  fromUom!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick both units of the conversion.' })
  @MaxLength(10)
  toUom!: string;

  @Transform(trimmed)
  @Matches(FACTOR, { message: 'The factor must be a number with up to 6 decimals.' })
  factor!: string;
}

/** Everything the item form (C03) saves. The code is only sent on create; it never changes. */
class ItemFieldsDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the item a name.' })
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick the item group.' })
  @MaxLength(50)
  itemGroup!: string;

  @IsIn(ITEM_TYPES, { message: 'Pick the type.' })
  type!: ItemType;

  @IsString()
  @IsNotEmpty({ message: 'Pick the base unit.' })
  @MaxLength(10)
  baseUom!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  barcode?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(10)
  einvoiceClassification?: string | null;

  @IsBoolean()
  isPurchasable!: boolean;

  @IsBoolean()
  isBuyToOrder!: boolean;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(10)
  purchaseUom?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(20)
  purchaseTaxCode?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(20)
  preferredSupplierCode?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(DECIMAL_4, { message: 'Reorder level must be a number with up to 4 decimals.' })
  reorderLevel?: string | null;

  @Transform(trimmed)
  @Matches(DECIMAL_4, { message: 'Pack size must be a number with up to 4 decimals.' })
  packSize!: string;

  @IsBoolean()
  isSellable!: boolean;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(10)
  salesUom?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(20)
  salesTaxCode?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(DECIMAL_4, { message: 'Standard cost must be an amount with up to 4 decimals.' })
  standardCost?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversionDto)
  conversions!: ConversionDto[];
}

export class CreateItemDto extends ItemFieldsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(ITEM_CODE, { message: 'The code is 2 to 30 capitals, digits and hyphens, like CH-DIN-01.' })
  code!: string;
}

export class UpdateItemDto extends ItemFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ItemVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version must be a whole number.' })
  @Min(1)
  version!: number;
}
