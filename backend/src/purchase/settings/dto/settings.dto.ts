import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;

export class ApprovalRuleDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @Matches(MONEY, { message: 'The limit must be an amount like 10000.00.' })
  thresholdAmount?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: 'The second approver limit must be an amount like 50000.00.' })
  secondOverAmount?: string | null;
}

export class ToleranceDto {
  @Matches(DECIMAL_4, { message: 'Price tolerance must be a number like 2.' })
  pricePct!: string;

  @Matches(DECIMAL_4, { message: 'Quantity tolerance must be a number like 0.' })
  qtyOver!: string;

  @Matches(MONEY, { message: 'Tax rounding must be an amount like 1.00.' })
  taxAmount!: string;
}

export class PolicySwitchesDto {
  @IsBoolean()
  rfqRequiredOn!: boolean;

  @Matches(MONEY, { message: 'The RFQ amount must be like 50000.00.' })
  rfqRequiredOver!: string;

  @IsBoolean()
  autoDraftBuyToOrder!: boolean;
}

export class SaveApprovalRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalRuleDto)
  rules!: ApprovalRuleDto[];

  @ValidateNested()
  @Type(() => ToleranceDto)
  tolerance!: ToleranceDto;

  @ValidateNested()
  @Type(() => PolicySwitchesDto)
  switches!: PolicySwitchesDto;
}

export class SequenceDto {
  @IsString()
  @MaxLength(20)
  docType!: string;

  @IsString()
  @MaxLength(20)
  prefix!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  digits!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  nextValue!: number;
}

export class PoTypeDto {
  @IsString()
  @MaxLength(10)
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'Give the type a name.' })
  @MaxLength(60)
  name!: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @IsBoolean()
  isActive!: boolean;
}

export class SaveDocumentTypesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SequenceDto)
  sequences!: SequenceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoTypeDto)
  poTypes!: PoTypeDto[];
}

export class SaveEmailTemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'Say who the email goes to.' })
  @MaxLength(200)
  toTemplate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ccTemplate?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'Write a subject.' })
  @MaxLength(300)
  subject!: string;

  @IsString()
  @IsNotEmpty({ message: 'Write the message.' })
  @MaxLength(10000)
  body!: string;

  @IsBoolean()
  attachPdf!: boolean;

  @IsBoolean()
  autoSend!: boolean;

  @IsBoolean()
  isActive!: boolean;
}
