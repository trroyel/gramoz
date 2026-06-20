import { IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetUsersQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class UpdateUserRoleDto {
  @IsEnum(['super_admin', 'admin', 'support', 'manager', 'customer'])
  role: string;
}

export class UpdateUserStatusDto {
  @IsEnum(['active', 'suspended', 'deleted'])
  status: string;
}
