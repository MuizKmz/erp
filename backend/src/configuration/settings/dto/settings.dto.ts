import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** A14 form. Ranges are checked by settingsErrors (sign-in.rules.ts) so the messages name the limits. */
export class UpdateSignInSettingsDto {
  @IsInt()
  version!: number;

  @IsOptional()
  @IsInt({ message: 'Shortest password: a whole number.' })
  passwordMinLength?: number;

  @IsOptional()
  @IsBoolean()
  refuseCommonPasswords?: boolean;

  /** null = never ask (SDD 10.2). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  passwordMaxAgeDays?: number | null;

  @IsOptional()
  @IsInt({ message: 'Lock the account after: a whole number.' })
  lockoutAttempts?: number;

  @IsOptional()
  @IsInt({ message: 'Lock for: a whole number of minutes.' })
  lockoutMinutes?: number;

  @IsOptional()
  @IsBoolean()
  lockoutPerAddress?: boolean;

  @IsOptional()
  @IsInt({ message: 'Sign out after no activity: a whole number of minutes.' })
  idleMinutes?: number;

  @IsOptional()
  @IsInt({ message: 'A device stays signed in: a whole number of days.' })
  refreshDays?: number;

  @IsOptional()
  @IsInt({ message: 'Links last: a whole number of minutes.' })
  linkMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  twoFactorRoles?: string[];

  @IsOptional()
  @IsBoolean()
  emailSetPasswordLink?: boolean;
}
