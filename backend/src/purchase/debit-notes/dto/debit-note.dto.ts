import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DebitLineDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;

  @Matches(DECIMAL_4, { message: 'Unit price must be a number with up to 4 decimals.' })
  unitPrice!: string;
}

class DebitFieldsDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Date must look like 2026-09-29.' })
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class CreateDebitNoteDto extends DebitFieldsDto {
  @IsUUID('all', { message: 'Pick the supplier invoice this adds to.' })
  invoiceId!: string;

  @IsString()
  @IsNotEmpty({ message: "Enter the supplier's debit note number." })
  @MaxLength(50)
  theirNoteNo!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick a reason.' })
  @MaxLength(200)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one charge.' })
  @ValidateNested({ each: true })
  @Type(() => DebitLineDto)
  lines!: DebitLineDto[];
}

export class UpdateDebitNoteDto extends DebitFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the debit note and try again.' })
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "Enter the supplier's debit note number." })
  @MaxLength(50)
  theirNoteNo?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Pick a reason.' })
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one charge.' })
  @ValidateNested({ each: true })
  @Type(() => DebitLineDto)
  lines?: DebitLineDto[];
}

export class DebitNoteVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the debit note and try again.' })
  version!: number;
}

export class SubmitDebitNoteDto extends DebitNoteVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class DebitableInvoicesQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the supplier.' })
  @MaxLength(20)
  supplierCode!: string;
}

export class DebitNoteListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  invoiceNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
