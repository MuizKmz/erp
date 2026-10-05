import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class EnquiryListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  agent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;
}

export class EnquiryItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remarks?: string;
}

class EnquiryFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Type a valid email address.' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Enquiry date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  agentCode?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'Budget must be an amount like 95000.00.' })
  budget?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Needed by must look like 2026-10-30.' })
  neededBy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  /** Answers to the enquiry type's extra details, by label. */
  @IsOptional()
  @IsObject()
  details?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnquiryItemDto)
  items?: EnquiryItemDto[];
}

export class CreateEnquiryDto extends EnquiryFieldsDto {
  /** Existing customer from Master Data, or a new prospect typed by name. */
  @IsOptional()
  @IsBoolean()
  isProspect?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  prospectName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branchCode?: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick the enquiry type.' })
  @MaxLength(20)
  enquiryTypeCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick where the enquiry came from.' })
  @MaxLength(20)
  sourceCode!: string;

  /** Save and forward to the agent in one step. */
  @IsOptional()
  @IsBoolean()
  forward?: boolean;
}

export class UpdateEnquiryDto extends EnquiryFieldsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  enquiryTypeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sourceCode?: string;
}

export class EnquiryVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class EnquiryLostDto extends EnquiryVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Say why the enquiry was lost.' })
  @MaxLength(200)
  reason!: string;
}

export const ENQ_STATUS_KEYS = ['new', 'forwarded', 'quoted', 'lost'] as const;
export class EnquiryStatusDto {
  @IsIn(ENQ_STATUS_KEYS)
  status!: string;
}
