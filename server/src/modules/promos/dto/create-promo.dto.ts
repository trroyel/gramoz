import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  Min,
} from 'class-validator';

export class CreatePromoDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsEnum(['percentage', 'fixed'])
  discountType: 'percentage' | 'fixed';

  @IsNumber()
  @Min(0)
  discountValue: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minOrderValue?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
