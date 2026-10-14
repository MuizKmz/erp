import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { ID_TYPES, type IdType } from '../../customers/customers.rules';
import { CURRENCIES } from '../suppliers.rules';

const PRICE = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upperOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value);

export class SupplierListQueryDto extends ListQueryDto {
  /** What they supply (exact text). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplies?: string;

  /** shown (default), hidden or only. */
  @IsOptional()
  @IsIn(['shown', 'hidden', 'only'], { message: 'Pick shown, hidden or only walk-in shops.' })
  walkIn?: 'shown' | 'hidden' | 'only';
}

export class ContractPriceDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the item.' })
  @MaxLength(30)
  itemCode!: string;

  @Transform(trimmed)
  @Matches(PRICE, { message: 'The price must be an amount with up to 4 decimals.' })
  unitPrice!: string;

  @Matches(DATE_ONLY, { message: 'The start date must look like 2026-01-01.' })
  validFrom!: string;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(DATE_ONLY, { message: 'The end date must look like 2026-12-31, or be empty for no end.' })
  validTo?: string | null;
}

/** Everything the supplier form (C07) saves. The code comes from numbering on create and never changes. */
class SupplierFieldsDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the supplier a name.' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  shortName?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(100)
  category?: string | null;

  @IsBoolean()
  isWalkIn!: boolean;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(100)
  contactName?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsEmail({}, { message: 'Type a valid email address.' })
  @MaxLength(150)
  email?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @Transform(upperOrNull)
  @Matches(/^[A-Z0-9]{5,20}$/, { message: 'A TIN is 5 to 20 capitals and digits, like C20881234050.' })
  tin?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsIn(ID_TYPES, { message: 'Pick BRN, NRIC, passport or army number.' })
  idType?: IdType | null;

  /** The ID number (registration number for a company). */
  @IsOptional()
  @Transform(upperOrNull)
  @Matches(/^[A-Z0-9-]{4,30}$/, { message: 'An ID number is 4 to 30 capitals, digits and hyphens.' })
  regNo?: string | null;

  /** The sales tax number. */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  sstNo?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  serviceTaxNo?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsEmail({}, { message: 'Type a valid email address.' })
  @MaxLength(150)
  einvoiceEmail?: string | null;

  @Type(() => Number)
  @IsInt({ message: 'Pick the payment term.' })
  @Min(0)
  paymentTermDays!: number;

  @IsIn(CURRENCIES, { message: 'Only MYR for now: buying in another currency comes later.' })
  currency!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractPriceDto)
  contractPrices!: ContractPriceDto[];
}

export class CreateSupplierDto extends SupplierFieldsDto {}

export class UpdateSupplierDto extends SupplierFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class SupplierVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version must be a whole number.' })
  @Min(1)
  version!: number;
}
