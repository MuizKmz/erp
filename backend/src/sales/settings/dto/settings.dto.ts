import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { APPROVER_ROLES, CREDIT_ACTIONS, CREDIT_DOCS } from '../settings.rules';

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
