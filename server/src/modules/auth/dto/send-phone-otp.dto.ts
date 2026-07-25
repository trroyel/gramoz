import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SendPhoneOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be a valid E.164 format or standard international format',
  })
  phone: string;
}
