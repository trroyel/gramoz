import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class ValidatePromoDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsNumber()
  @Min(0)
  subtotal: number;
}
