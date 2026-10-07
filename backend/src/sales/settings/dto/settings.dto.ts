import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { APPROVER_ROLES, CREDIT_ACTIONS, CREDIT_DOCS, EXCLUSION_REASONS } from '../settings.rules';

export class CreditRuleDto {
  @IsIn(CREDIT_DOCS)
  docType!: (typeof CREDIT_DOCS)[number];

  @IsIn(CREDIT_ACTIONS, { message: 'Pick what happens over the credit limit.' })
  overCreditAction!: (typeof CREDIT_ACTIONS)[number];

  @IsIn(CREDIT_ACTIONS, { message: 'Pick what happens over the overdue limit.' })
  overOverdueAction!: (typeof CREDIT_ACTIONS)[number];

  @IsOptional()
  @IsIn(APPROVER_ROLES, { message: 'Pick Sales Manager or Finance Manager.' })
  approverRole!: string | null;
}

export class SaveCreditControlDto {
  @IsIn(['GROUP', 'BRANCH'])
  creditScope!: 'GROUP' | 'BRANCH';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreditRuleDto)
  rules!: CreditRuleDto[];

  @IsBoolean() stockCheck!: boolean;
  @IsBoolean() invoiceFromDelivered!: boolean;
  @IsBoolean() strictPriceList!: boolean;
  @IsBoolean() roundTo5Sen!: boolean;
  @IsBoolean() showMargin!: boolean;
  @IsBoolean() skipCreditForSystem!: boolean;
}

export class SequenceDto {
  @IsString()
  @MaxLength(20)
  docType!: string;

  @IsIn(['NEVER', 'MONTH'])
  resetEvery!: 'NEVER' | 'MONTH';

  @IsBoolean()
  perBranch!: boolean;
}

export class SaveDocumentTypesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SequenceDto)
  sequences!: SequenceDto[];
}

export class AddOrderTypeDto {
  @IsString()
  @MinLength(2, { message: 'Give the type a name.' })
  @MaxLength(60)
  name!: string;

  @IsString()
  @MinLength(2, { message: 'Say what the type means.' })
  @MaxLength(200)
  meaning!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class EnquiryDetailDto {
  @IsString()
  @MinLength(1, { message: 'Give each extra detail a name.' })
  @MaxLength(60)
  label!: string;

  @IsIn(['TEXT', 'CHOICE', 'FILE', 'NUMBER', 'DATE'])
  kind!: 'TEXT' | 'CHOICE' | 'FILE' | 'NUMBER' | 'DATE';

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  choices?: string[];
}

export class EnquiryTypeDto {
  @IsString()
  @MinLength(2, { message: 'Give the type a name.' })
  @MaxLength(60)
  name!: string;

  @IsIn(['CUSTOMER', 'ROUND_ROBIN'])
  defaultAgentRule!: 'CUSTOMER' | 'ROUND_ROBIN';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnquiryDetailDto)
  details!: EnquiryDetailDto[];

  @IsBoolean()
  isActive!: boolean;
}

export class EnquirySourceDto {
  @IsString()
  @MinLength(2, { message: 'Give the source a name.' })
  @MaxLength(60)
  name!: string;
}

export class ExclusionQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;

  @IsOptional()
  @IsIn(['active', 'ended', 'all'])
  state?: string;
}

export class AddExclusionDto {
  @IsString()
  @MinLength(1, { message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @IsString()
  @MinLength(1, { message: 'Pick a branch.' })
  @MaxLength(10)
  branchCode!: string;

  @IsIn(EXCLUSION_REASONS, { message: 'Choose a reason.' })
  reason!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'From must look like 2026-09-29.' })
  fromDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Until must look like 2026-12-31.' })
  untilDate?: string;
}

export class SaveTemplateDto {
  @IsString()
  @MinLength(2, { message: 'Write a subject.' })
  @MaxLength(300)
  subject!: string;

  @IsString()
  @MinLength(2, { message: 'Write the message.' })
  @MaxLength(5000)
  body!: string;

  @IsBoolean()
  attachPdf!: boolean;

  @IsBoolean()
  copyAgent!: boolean;
}

export class PreviewTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;
}

export class NewTemplateDto {
  @IsString()
  @MinLength(2, { message: 'Give the template a name.' })
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
