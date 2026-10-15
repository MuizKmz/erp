import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SignInDto {
  /** Email or user code (choice 11). */
  @IsString()
  @IsNotEmpty({ message: 'Type your email or user code.' })
  @MaxLength(150)
  identifier!: string;

  @IsString()
  @IsNotEmpty({ message: 'Type your password.' })
  @MaxLength(200)
  password!: string;
}

export class SwitchBranchDto {
  @IsString()
  @IsNotEmpty({ message: 'Pick a branch.' })
  @MaxLength(10)
  branchCode!: string;
}

/** The step after the password (A03): the ticket from sign-in and a code from the app or a recovery code. */
export class TwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  ticket!: string;

  @IsString()
  @IsNotEmpty({ message: 'Type the code from the app.' })
  @MaxLength(20)
  code!: string;
}

export class ForgotDto {
  @IsString()
  @IsNotEmpty({ message: 'Type your email or user code.' })
  @MaxLength(150)
  identifier!: string;
}

export class LinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

export class ResetPasswordDto extends LinkDto {
  @IsString()
  @IsNotEmpty({ message: 'Type a new password.' })
  @MaxLength(200)
  newPassword!: string;
}
