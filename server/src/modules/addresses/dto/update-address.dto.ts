import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class UpdateAddressDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @IsOptional()
  addressLine2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  zipCode?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsString()
  @IsOptional()
  latitude?: string;

  @IsString()
  @IsOptional()
  longitude?: string;

  @IsUUID()
  @IsOptional()
  zoneId?: string;
}
