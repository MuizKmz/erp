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
