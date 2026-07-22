import { IsUUID, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  addressLine1: string;

  @IsString()
  city: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  promoCode?: string;

  @IsOptional()
  usePoints?: boolean;

  @IsString()
  @IsOptional()
  latitude?: string;

  @IsString()
  @IsOptional()
  longitude?: string;

  @IsString()
  @IsOptional()
  zoneId?: string;

  @IsString()
  @IsOptional()
  deliveryMethod?: 'home' | 'branch';
}
