import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LlmModel,
  Agent,
  Skill,
  PolicyBinding,
} from './entities';
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
} from './dto/registry.dto';

@Injectable()
export class RegistryService {
  constructor(
    @InjectRepository(LlmModel)
    private llmModelRepo: Repository<LlmModel>,
    @InjectRepository(Agent)
    private agentRepo: Repository<Agent>,
    @InjectRepository(Skill)
    private skillRepo: Repository<Skill>,
    @InjectRepository(PolicyBinding)
    private policyBindingRepo: Repository<PolicyBinding>,
  ) {}

  async createLlmModel(dto: CreateLlmModelDto): Promise<LlmModelResponseDto> {
    const model = this.llmModelRepo.create(dto);
    return this.llmModelRepo.save(model);
  }

  async findAllLlmModels(
    page = 1,
    limit = 20,
  ): Promise<RegistryListResponseDto<LlmModelResponseDto>> {
    const [data, total] = await this.llmModelRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { data, pagination: { page, limit, total } };
  }

  async findLlmModel(id: string): Promise<LlmModelResponseDto> {
    const model = await this.llmModelRepo.findOne({ where: { id } });
    if (!model) throw new NotFoundException('Model not found');
    return model;
  }

  async updateLlmModel(
    id: string,
    dto: UpdateLlmModelDto,
  ): Promise<LlmModelResponseDto> {
    const model = await this.findLlmModel(id);
    Object.assign(model, dto);
    return this.llmModelRepo.save(model);
  }

  async deleteLlmModel(id: string): Promise<void> {
    const result = await this.llmModelRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Model not found');
  }

  async createAgent(
    tenantId: string,
    dto: CreateAgentDto,
  ): Promise<AgentResponseDto> {
    const agent = this.agentRepo.create({ ...dto, tenantId });
    return this.agentRepo.save(agent);
  }

  async findAllAgents(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<RegistryListResponseDto<AgentResponseDto>> {
    const [data, total] = await this.agentRepo.findAndCount({
      where: { tenantId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { data, pagination: { page, limit, total } };
  }

  async findAgent(tenantId: string, id: string): Promise<AgentResponseDto> {
    const agent = await this.agentRepo.findOne({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  async updateAgent(
    tenantId: string,
    id: string,
    dto: UpdateAgentDto,
  ): Promise<AgentResponseDto> {
    const agent = await this.findAgent(tenantId, id);
    Object.assign(agent, dto);
    return this.agentRepo.save(agent);
  }

  async deleteAgent(tenantId: string, id: string): Promise<void> {
    const result = await this.agentRepo.delete({ id, tenantId });
    if (result.affected === 0) throw new NotFoundException('Agent not found');
  }

  async createSkill(
    tenantId: string,
    dto: CreateSkillDto,
  ): Promise<SkillResponseDto> {
    const skill = this.skillRepo.create({ ...dto, tenantId });
    return this.skillRepo.save(skill);
  }

  async findAllSkills(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<RegistryListResponseDto<SkillResponseDto>> {
    const [data, total] = await this.skillRepo.findAndCount({
      where: { tenantId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { data, pagination: { page, limit, total } };
  }

  async findSkill(tenantId: string, id: string): Promise<SkillResponseDto> {
    const skill = await this.skillRepo.findOne({ where: { id, tenantId } });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  async updateSkill(
    tenantId: string,
    id: string,
    dto: UpdateSkillDto,
  ): Promise<SkillResponseDto> {
    const skill = await this.findSkill(tenantId, id);
    Object.assign(skill, dto);
    return this.skillRepo.save(skill);
  }

  async deleteSkill(tenantId: string, id: string): Promise<void> {
    const result = await this.skillRepo.delete({ id, tenantId });
    if (result.affected === 0) throw new NotFoundException('Skill not found');
  }

  async attachPolicy(dto: AttachPolicyDto): Promise<PolicyBindingResponseDto> {
    const binding = this.policyBindingRepo.create(dto);
    return this.policyBindingRepo.save(binding);
  }

  async detachPolicy(dto: DetachPolicyDto): Promise<void> {
    const result = await this.policyBindingRepo.delete({
      policyId: dto.policyId,
      targetType: dto.targetType,
      targetId: dto.targetId,
    });
    if (result.affected === 0) throw new NotFoundException('Binding not found');
  }

  async findBindingsForTarget(
    targetType: string,
    targetId: string,
  ): Promise<PolicyBindingResponseDto[]> {
    return this.policyBindingRepo.find({
      where: { targetType: targetType as any, targetId },
    });
  }
}
