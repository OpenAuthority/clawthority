import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject, IsInt, Min } from 'class-validator';
import { PolicyStatus } from '../../common/entities';

export class CreatePolicyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsObject()
  @IsNotEmpty()
  spec: Record<string, unknown>;
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;
}

export class PromotePolicyDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class PolicyVersionDto {
  @IsInt()
  @Min(1)
  version: number;
}

export class PolicyResponseDto {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  spec: Record<string, unknown>;
  version: number;
  status: PolicyStatus;
  createdById: string | undefined;
  reviewedById: string | undefined;
  createdAt: Date;
  updatedAt: Date;
  promotedAt: Date | undefined;
}

export class PolicyVersionResponseDto {
  id: string;
  policyId: string;
  version: number;
  spec: Record<string, unknown>;
  changelog: string;
  createdById: string;
  createdAt: Date;
}

export class PaginationDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}

export class PolicyListResponseDto {
  data: PolicyResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}
