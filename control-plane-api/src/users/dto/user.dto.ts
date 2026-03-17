import { IsString, IsEmail, IsNotEmpty, IsOptional, IsEnum, IsObject } from 'class-validator';
import { UserRole, UserStatus } from '../../common/entities';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(UserRole)
  role: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UserResponseDto {
  id: string;
  tenantId: string;
  email: string;
  name: string | undefined;
  role: UserRole;
  status: UserStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
