import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ReturnLineDto {
  @IsUUID('all', { message: 'Goods receipt line not found.' })
  grnLineId!: string;

  @Matches(DECIMAL_4, { message: 'Return quantity must be a number with up to 4 decimals.' })
  qty!: string;
}

class ReturnFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Return date must look like 2026-09-28.' })
  docDate?: string;

  @IsOptional()
  @IsIn(['CREDIT_NOTE', 'REPLACEMENT'], { message: 'Settle by credit note or replacement.' })
  settleBy?: 'CREDIT_NOTE' | 'REPLACEMENT';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rmaNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  collection?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  /** Photos and the supplier's RMA, uploaded first through /attachments. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class CreateReturnDto extends ReturnFieldsDto {
  @IsUUID('all', { message: 'Pick the goods receipt.' })
  grnId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick a reason.' })
  @MaxLength(200)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'There is nothing left to return on this receipt.' })
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

export class UpdateReturnDto extends ReturnFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the return and try again.' })
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Pick a reason.' })
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines?: ReturnLineDto[];
}

export class ReturnVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the return and try again.' })
  version!: number;
}

/** The supplier's credit note settles a return (FlowP6 step 8). */
export class CreditNoteDto extends ReturnVersionDto {
  @IsString()
  @IsNotEmpty({ message: "Enter the supplier's credit note number." })
  @MaxLength(50)
  creditNoteNo!: string;
}

/** The supplier delivered replacement goods instead of a credit. */
export class ReplacementDto extends ReturnVersionDto {
  @IsString()
  @IsNotEmpty({ message: "Enter the supplier's delivery order number for the replacement." })
  @MaxLength(50)
  supplierDoNo!: string;
}

export class NewReturnQueryDto {
  @IsUUID('all', { message: 'Pick the goods receipt.' })
  grnId!: string;
}

export class ReturnListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  grnNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
