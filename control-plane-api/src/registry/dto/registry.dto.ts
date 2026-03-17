import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsObject,
  IsUUID,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ModelProvider } from '../entities/llm-model.entity';
import { AgentType } from '../entities/agent.entity';
import { SkillType } from '../entities/skill.entity';
import { PolicyTargetType } from '../entities/policy-binding.entity';

export class CreateLlmModelDto {
  @IsEnum(ModelProvider)
  provider: ModelProvider;

  @IsString()
  @IsNotEmpty()
  modelId: string;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsNumber()
  pricePer1kInputTokens?: number;

  @IsOptional()
  @IsNumber()
  pricePer1kOutputTokens?: number;

  @IsOptional()
  @IsNumber()
  defaultRateLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateLlmModelDto {
  @IsOptional()
  @IsEnum(ModelProvider)
  provider?: ModelProvider;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsNumber()
  pricePer1kInputTokens?: number;

  @IsOptional()
  @IsNumber()
  pricePer1kOutputTokens?: number;

  @IsOptional()
  @IsNumber()
  defaultRateLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LlmModelResponseDto {
  id: string;
  provider: ModelProvider;
  modelId: string;
  endpointUrl: string | undefined;
  pricePer1kInputTokens: number | undefined;
  pricePer1kOutputTokens: number | undefined;
  defaultRateLimit: number;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(AgentType)
  type: AgentType;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(AgentType)
  type?: AgentType;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AgentResponseDto {
  id: string;
  tenantId: string;
  name: string;
  type: AgentType;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class CreateSkillDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(SkillType)
  type: SkillType;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isOpenClawEnabled?: boolean;
}

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(SkillType)
  type?: SkillType;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isOpenClawEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SkillResponseDto {
  id: string;
  tenantId: string;
  name: string;
  type: SkillType;
  config: Record<string, unknown>;
  isOpenClawEnabled: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class AttachPolicyDto {
  @IsUUID()
  @IsNotEmpty()
  policyId: string;

  @IsEnum(PolicyTargetType)
  targetType: PolicyTargetType;

  @IsUUID()
  @IsNotEmpty()
  targetId: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class DetachPolicyDto {
  @IsUUID()
  @IsNotEmpty()
  policyId: string;

  @IsEnum(PolicyTargetType)
  targetType: PolicyTargetType;

  @IsUUID()
  @IsNotEmpty()
  targetId: string;
}

export class PolicyBindingResponseDto {
  id: string;
  policyId: string;
  targetType: PolicyTargetType;
  targetId: string;
  config: Record<string, unknown>;
  createdAt: Date;
}

export class ListQueryDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}

export class RegistryListResponseDto<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}
