import { IsEmail, IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(8, 8)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}
