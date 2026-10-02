import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';

const DECIMAL_4 = /^\d{1,14}(\.\d{1,4})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class RfqLineDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick an item from Master Data.' })
  @MaxLength(30)
  itemCode!: string;

  @Matches(DECIMAL_4, { message: 'Quantity must be a number with up to 4 decimals.' })
  qty!: string;
}

/** New RFQ: items (or a request to take them from), the suppliers to ask and the reply-by date. Sent at once. */
export class CreateRfqDto {
  /** Purchase request this RFQ answers; its lines are used when `lines` is left out. */
  @IsOptional()
  @IsUUID('all', { message: 'Request not found.' })
  requestId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item.' })
  @ValidateNested({ each: true })
  @Type(() => RfqLineDto)
  lines?: RfqLineDto[];

  @IsArray()
  @ArrayMinSize(1, { message: 'Pick at least one supplier to ask.' })
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  supplierCodes!: string[];

  @Matches(DATE_ONLY, { message: 'Pick the date replies are due.' })
  replyBy!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Needed by must look like 2026-09-29.' })
  neededBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class RfqVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required. Reload the RFQ and try again.' })
  version!: number;
}

class ReplyLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lineNo!: number;

  @Matches(DECIMAL_4, { message: 'Enter the unit price the supplier quoted.' })
  unitPrice!: string;

  @IsOptional()
  @Matches(DECIMAL_4, { message: 'Minimum order must be a number.' })
  minOrderQty?: string;
}

/** The buyer types in a reply the supplier sent (email, phone or their quote PDF). */
export class RecordReplyDto extends RfqVersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  supplierCode!: string;

  /** The supplier said they will not quote. */
  @IsOptional()
  @IsBoolean()
  declined?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplyLineDto)
  lines?: ReplyLineDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Delivery time is a whole number of days.' })
  @Min(0)
  @Max(365, { message: 'Delivery time cannot be more than 365 days.' })
  leadTimeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Payment term is a whole number of days.' })
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Valid until must look like 2026-10-06.' })
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  quoteRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Their quote PDF, uploaded first through /attachments. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class AddSupplierDto extends RfqVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick a supplier.' })
  @MaxLength(20)
  supplierCode!: string;
}

export class RemindDto {
  /** One supplier; all suppliers still waiting when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  supplierCode?: string;
}

export class AwardRfqDto extends RfqVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the supplier to award.' })
  @MaxLength(20)
  supplierCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'The reason cannot be longer than 2,000 characters.' })
  reason?: string;
}

export class CloseRfqDto extends RfqVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Say why no supplier is chosen, e.g. too costly.' })
  @MaxLength(300, { message: 'The reason cannot be longer than 300 characters.' })
  reason!: string;
}

export class RfqListQueryDto extends ListQueryDto {
  /** Text: item code or name */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  item?: string;

  /** Text: supplier code or name */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  buyer?: string;

}
