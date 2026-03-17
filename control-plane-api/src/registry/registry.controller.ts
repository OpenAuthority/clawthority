import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RegistryService } from './registry.service';
import {
  CreateLlmModelDto,
  UpdateLlmModelDto,
  LlmModelResponseDto,
  CreateAgentDto,
  UpdateAgentDto,
  AgentResponseDto,
  CreateSkillDto,
  UpdateSkillDto,
  SkillResponseDto,
  AttachPolicyDto,
  DetachPolicyDto,
  PolicyBindingResponseDto,
  RegistryListResponseDto,
  ListQueryDto,
} from './dto/registry.dto';
import { PolicyTargetType } from './entities/policy-binding.entity';

@Controller()
export class RegistryController {
  constructor(private readonly registryService: RegistryService) {}

  @Post('models')
  createLlmModel(
    @Body() dto: CreateLlmModelDto,
  ): Promise<LlmModelResponseDto> {
    return this.registryService.createLlmModel(dto);
  }

  @Get('models')
  findAllLlmModels(
    @Query() query: ListQueryDto,
  ): Promise<RegistryListResponseDto<LlmModelResponseDto>> {
    return this.registryService.findAllLlmModels(query.page, query.limit);
  }

  @Get('models/:id')
  findLlmModel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LlmModelResponseDto> {
    return this.registryService.findLlmModel(id);
  }

  @Put('models/:id')
  updateLlmModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLlmModelDto,
  ): Promise<LlmModelResponseDto> {
    return this.registryService.updateLlmModel(id, dto);
  }

  @Delete('models/:id')
  deleteLlmModel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.registryService.deleteLlmModel(id);
  }

  @Post('tenants/:tenantId/agents')
  createAgent(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateAgentDto,
  ): Promise<AgentResponseDto> {
    return this.registryService.createAgent(tenantId, dto);
  }

  @Get('tenants/:tenantId/agents')
  findAllAgents(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListQueryDto,
  ): Promise<RegistryListResponseDto<AgentResponseDto>> {
    return this.registryService.findAllAgents(tenantId, query.page, query.limit);
  }

  @Get('tenants/:tenantId/agents/:id')
  findAgent(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentResponseDto> {
    return this.registryService.findAgent(tenantId, id);
  }

  @Put('tenants/:tenantId/agents/:id')
  updateAgent(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<AgentResponseDto> {
    return this.registryService.updateAgent(tenantId, id, dto);
  }

  @Delete('tenants/:tenantId/agents/:id')
  deleteAgent(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.registryService.deleteAgent(tenantId, id);
  }

  @Post('tenants/:tenantId/skills')
  createSkill(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateSkillDto,
  ): Promise<SkillResponseDto> {
    return this.registryService.createSkill(tenantId, dto);
  }

  @Get('tenants/:tenantId/skills')
  findAllSkills(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListQueryDto,
  ): Promise<RegistryListResponseDto<SkillResponseDto>> {
    return this.registryService.findAllSkills(tenantId, query.page, query.limit);
  }

  @Get('tenants/:tenantId/skills/:id')
  findSkill(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SkillResponseDto> {
    return this.registryService.findSkill(tenantId, id);
  }

  @Put('tenants/:tenantId/skills/:id')
  updateSkill(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
  ): Promise<SkillResponseDto> {
    return this.registryService.updateSkill(tenantId, id, dto);
  }

  @Delete('tenants/:tenantId/skills/:id')
  deleteSkill(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.registryService.deleteSkill(tenantId, id);
  }

  @Post('policy-bindings')
  attachPolicy(
    @Body() dto: AttachPolicyDto,
  ): Promise<PolicyBindingResponseDto> {
    return this.registryService.attachPolicy(dto);
  }

  @Delete('policy-bindings')
  detachPolicy(
    @Body() dto: DetachPolicyDto,
  ): Promise<void> {
    return this.registryService.detachPolicy(dto);
  }

  @Get('policy-bindings/:targetType/:targetId')
  findBindingsForTarget(
    @Param('targetType') targetType: PolicyTargetType,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<PolicyBindingResponseDto[]> {
    return this.registryService.findBindingsForTarget(targetType, targetId);
  }
}
