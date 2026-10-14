import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min } from 'class-validator';
import { WAREHOUSE_CODE } from '../warehouses.rules';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class WarehouseFieldsDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the warehouse a name.' })
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick the branch.' })
  @MaxLength(10)
  branchCode!: string;
}

export class CreateWarehouseDto extends WarehouseFieldsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(WAREHOUSE_CODE, { message: 'Use capitals, digits and dashes, like KL-MAIN (up to 20).' })
  code!: string;
}

export class UpdateWarehouseDto extends WarehouseFieldsDto {
  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class WarehouseVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
