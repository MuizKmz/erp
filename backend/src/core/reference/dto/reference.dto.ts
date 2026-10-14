import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

/** One reference entry: its name, and for a credit term the days it gives. */
export class ReferenceEntryDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give it a name.' })
  @MaxLength(50)
  name!: string;

  /** Credit terms only: days to pay, 0 for cash. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Days must be a whole number.' })
  @Min(0, { message: 'Days cannot be below 0.' })
  @Max(365, { message: 'Days can be at most 365.' })
  days?: number;
}

export class UpdateReferenceEntryDto extends ReferenceEntryDto {
  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReferenceVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
