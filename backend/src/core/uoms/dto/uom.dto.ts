import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_DECIMALS, UOM_CODE } from '../uoms.rules';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class UomFieldsDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the unit a name.' })
  @MaxLength(50)
  name!: string;

  @Type(() => Number)
  @IsInt({ message: 'Decimals must be a whole number.' })
  @Min(0, { message: 'Decimals cannot be below 0.' })
  @Max(MAX_DECIMALS, { message: `Decimals can be at most ${MAX_DECIMALS}: quantities are stored with ${MAX_DECIMALS}.` })
  decimals!: number;
}

export class CreateUomDto extends UomFieldsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(UOM_CODE, { message: 'The code is a capital, then up to 9 capitals or digits, like PCS or ROLL.' })
  code!: string;
}

export class UpdateUomDto extends UomFieldsDto {
  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class UomVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'Version must be a whole number.' })
  @Min(1)
  version!: number;
}
