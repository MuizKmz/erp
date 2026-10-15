import { Transform, Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../../platform/http/list-query.dto';
import { USER_CODE } from '../users.rules';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class UserListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;

  @IsOptional()
  @IsIn(['missing', 'set', 'notRequired'])
  twoFactor?: string;
}

export class RoleAssignmentDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick the role.' })
  roleCode!: string;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(DAY, { message: 'From must look like 2026-10-01.' })
  validFrom?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(DAY, { message: 'Until must look like 2026-12-31.' })
  validUntil?: string | null;
}

class UserFields {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the user a name.' })
  @MaxLength(100)
  name!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address. Sign-in and reset links go there.' })
  @MaxLength(150)
  email!: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  jobTitle?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  department?: string | null;

  /** The main role first ("Signed in as Lim Mei Ying, Buyer"). */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles!: RoleAssignmentDto[];

  @IsArray()
  @IsString({ each: true })
  branches!: string[];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  defaultBranch?: string | null;
}

export class CreateUserDto extends UserFields {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(USER_CODE, { message: 'Use capitals, digits, dashes or underscores, like LMY (up to 20).' })
  code!: string;
}

export class UpdateUserDto extends UserFields {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class UserVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
