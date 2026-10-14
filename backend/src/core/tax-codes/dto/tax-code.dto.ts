import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PERCENT, TAX_CODE, TAX_TYPES, type TaxType } from '../tax-codes.rules';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class NameDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the rate a name, like SST 10%.' })
  @MaxLength(60)
  name!: string;
}

/** C10 Add tax code: the code, its type and its first rate. */
export class CreateTaxCodeDto extends NameDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(TAX_CODE, { message: 'The code is a capital, then capitals or digits, like SST10 (up to 20).' })
  code!: string;

  @IsIn(TAX_TYPES, { message: 'Pick sales tax, service tax or exempt.' })
  type!: TaxType;

  /** A percentage: "10" for 10%. */
  @Transform(trimmed)
  @Matches(PERCENT, { message: 'The rate is a percentage with up to 2 decimals, like 10 or 6.5.' })
  rate!: string;

  @Matches(DATE_ONLY, { message: 'The start date must look like 2026-10-01.' })
  validFrom!: string;
}

/** The code's own fields: the latest rate's name, the type and whether it is active. */
export class UpdateTaxCodeDto extends NameDto {
  @IsIn(TAX_TYPES, { message: 'Pick sales tax, service tax or exempt.' })
  type!: TaxType;

  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

/** C10 New rate: from a date, closing the one before it the day before. */
export class NewRateDto extends NameDto {
  @Transform(trimmed)
  @Matches(PERCENT, { message: 'The rate is a percentage with up to 2 decimals, like 10 or 6.5.' })
  rate!: string;

  @Matches(DATE_ONLY, { message: 'The start date must look like 2027-01-01.' })
  validFrom!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class TaxCodeVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
