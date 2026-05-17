import { IsUUID, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  addressLine1: string;

  @IsString()
  city: string;

  @IsString()
  phone: string;

  @IsUUID()
  @IsOptional()
  couponId?: string; // reserved for future coupon support
}
