import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { BRANCH_CODE, COMPANY_CODE } from '../organisation.rules';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const upperOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value);

/** Fields shared by the company and its branches: where to reach them. */
class ContactFields {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(150)
  email?: string | null;
}

class CompanyFields extends ContactFields {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the company its legal name.' })
  @MaxLength(150)
  legalName!: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  registrationNo?: string | null;

  @Transform(upperOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  tin?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  salesTaxNo?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  serviceTaxNo?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  myinvoisName?: string | null;
}

export class CreateCompanyDto extends CompanyFields {
  @Transform(upper)
  @Matches(COMPANY_CODE, { message: 'Use capitals, digits and dashes, like CLB (up to 20).' })
  code!: string;
}

export class UpdateCompanyDto extends CompanyFields {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

class BranchFields extends ContactFields {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'Give the branch a name.' })
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick the company.' })
  legalEntityId!: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @Transform(upperOrNull)
  @IsOptional()
  @Matches(BRANCH_CODE, { message: 'Use capitals, digits and dashes, like PNG (up to 10).' })
  docPrefix?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  myinvoisBranchName?: string | null;
}

export class CreateBranchDto extends BranchFields {
  @Transform(upper)
  @Matches(BRANCH_CODE, { message: 'Use capitals, digits and dashes, like PNG (up to 10).' })
  code!: string;
}

export class UpdateBranchDto extends BranchFields {
  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class OrganisationVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
