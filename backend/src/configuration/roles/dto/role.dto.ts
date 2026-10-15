import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ROLE_CODE } from '../roles.rules';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

class RoleFields {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the role a name.' })
  @MaxLength(100)
  name!: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsBoolean()
  agentScopeCustomers!: boolean;

  @IsBoolean()
  agentScopeDocuments!: boolean;

  /** Keys from the permission catalogue (rule 5). */
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class CreateRoleDto extends RoleFields {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(ROLE_CODE, { message: 'Use capitals, digits and underscores, starting with a letter, like QA_LEAD (up to 30).' })
  code!: string;
}

export class UpdateRoleDto extends RoleFields {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class RoleVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CompareRolesQueryDto {
  @IsString()
  @IsNotEmpty()
  a!: string;

  @IsString()
  @IsNotEmpty()
  b!: string;
}
