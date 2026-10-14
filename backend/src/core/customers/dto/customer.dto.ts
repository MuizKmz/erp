import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { CREDIT_SCOPES, ENQUIRY_NO, ID_TYPES, TAX_MODES, type IdType } from '../customers.rules';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upperOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value);

export class CustomerListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  agent?: string;
}

/** Everything the customer form (C05) saves. The code comes from numbering on create and never changes. */
class CustomerFieldsDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the customer a name.' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(50)
  category?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(50)
  area?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'Pick the branch.' })
  @MaxLength(10)
  branchCode!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(20)
  defaultAgentCode?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(300)
  billingAddress?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(300)
  deliveryAddress?: string | null;

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
  @Transform(upperOrNull)
  @Matches(/^[A-Z0-9]{5,20}$/, { message: 'A TIN is 5 to 20 capitals and digits, like C20881234050.' })
  tin?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsIn(ID_TYPES, { message: 'Pick BRN, NRIC, passport or army number.' })
  idType?: IdType | null;

  @IsOptional()
  @Transform(upperOrNull)
  @Matches(/^[A-Z0-9-]{4,30}$/, { message: 'An ID number is 4 to 30 capitals, digits and hyphens.' })
  idNumber?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  salesTaxNo?: string | null;

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

  @IsIn(TAX_MODES, { message: 'Pick Exclusive or Inclusive.' })
  taxMode!: (typeof TAX_MODES)[number];

  @Type(() => Number)
  @IsInt({ message: 'Pick the credit term.' })
  @Min(0)
  creditTermDays!: number;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(MONEY, { message: 'Credit limit must be an amount like 150000.00, or empty for no limit.' })
  creditLimit?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(MONEY, { message: 'Overdue limit must be an amount like 5000.00, or empty for no limit.' })
  overdueLimit?: string | null;

  /** Empty = as Credit Control says (S29). */
  @IsOptional()
  @Transform(blankToNull)
  @IsIn(CREDIT_SCOPES, { message: 'Pick group-wide or per branch.' })
  creditScope?: (typeof CREDIT_SCOPES)[number] | null;

  @IsString()
  @IsNotEmpty({ message: 'Pick the price list.' })
  @MaxLength(20)
  priceListCode!: string;
}

export class CreateCustomerDto extends CustomerFieldsDto {
  /** A prospect (C04's Prospect tab) cannot be quoted until it is activated. */
  @IsOptional()
  @IsIn(['ACTIVE', 'PROSPECT'])
  status?: 'ACTIVE' | 'PROSPECT';

  /** The enquiry the new customer came from: Sales then links that enquiry to it (decision 7). */
  @IsOptional()
  @Transform(upperOrNull)
  @Matches(ENQUIRY_NO, { message: 'Type the enquiry number as Sales shows it, like EQ-2609-0010.' })
  cameFromEnquiry?: string | null;
}

export class UpdateCustomerDto extends CustomerFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CustomerVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version must be a whole number.' })
  @Min(1)
  version!: number;
}
