import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Policy, PolicyVersion, PolicyPromotion, PolicyStatus } from '../common/entities';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  PromotePolicyDto,
  PolicyResponseDto,
  PolicyVersionResponseDto,
  PolicyListResponseDto,
} from './dto/policy.dto';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';

const STATUS_TRANSITIONS: Record<PolicyStatus, PolicyStatus | null> = {
  [PolicyStatus.DRAFT]: PolicyStatus.REVIEW,
  [PolicyStatus.REVIEW]: PolicyStatus.ACTIVE,
  [PolicyStatus.ACTIVE]: PolicyStatus.DEPRECATED,
  [PolicyStatus.DEPRECATED]: null,
};

@Injectable()
export class PoliciesService {
  constructor(
    @InjectRepository(Policy)
    private readonly policyRepository: Repository<Policy>,
    @InjectRepository(PolicyVersion)
    private readonly versionRepository: Repository<PolicyVersion>,
    @InjectRepository(PolicyPromotion)
    private readonly promotionRepository: Repository<PolicyPromotion>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async findAll(
    tenantId: string,
    status?: PolicyStatus,
    page = 1,
    limit = 20,
  ): Promise<PolicyListResponseDto> {
    const where: FindOptionsWhere<Policy> = { tenantId };
    if (status) where.status = status;

    const [data, total] = await this.policyRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return { data, pagination: { page, limit, total } };
  }

  async findOne(tenantId: string, id: string): Promise<Policy> {
    const policy = await this.policyRepository.findOne({
      where: { id, tenantId },
    });
    if (!policy) {
      throw new NotFoundException(`Policy ${id} not found`);
    }
    return policy;
  }

  async create(tenantId: string, dto: CreatePolicyDto, userId?: string): Promise<PolicyResponseDto> {
    const policy = this.policyRepository.create({
      ...dto,
      tenantId,
      createdById: userId,
      version: 1,
      status: PolicyStatus.DRAFT,
    });
    const saved = await this.policyRepository.save(policy);

    await this.versionRepository.save({
      policyId: saved.id,
      version: 1,
      spec: dto.spec,
      createdById: userId,
    });

    return saved;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePolicyDto,
    userId?: string,
  ): Promise<PolicyResponseDto> {
    const policy = await this.findOne(tenantId, id);

    if (policy.status !== PolicyStatus.DRAFT && policy.status !== PolicyStatus.REVIEW) {
      throw new BadRequestException('Only draft or review policies can be updated');
    }

    if (dto.spec) {
      policy.version += 1;
      await this.versionRepository.save({
        policyId: policy.id,
        version: policy.version,
        spec: dto.spec,
        createdById: userId,
      });
    }

    Object.assign(policy, dto);
    return this.policyRepository.save(policy);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const policy = await this.findOne(tenantId, id);
    if (policy.status === PolicyStatus.ACTIVE) {
      throw new BadRequestException('Cannot delete an active policy');
    }
    await this.policyRepository.remove(policy);
  }

  async promote(
    tenantId: string,
    id: string,
    dto: PromotePolicyDto,
    userId?: string,
  ): Promise<PolicyResponseDto> {
    const policy = await this.findOne(tenantId, id);
    const nextStatus = STATUS_TRANSITIONS[policy.status];

    if (!nextStatus) {
      throw new BadRequestException(`Cannot promote from ${policy.status}`);
    }

    const previousStatus = policy.status;
    policy.status = nextStatus;
    policy.promotedAt = new Date();

    if (nextStatus === PolicyStatus.ACTIVE && userId) {
      policy.reviewedById = userId;
    }

    await this.policyRepository.save(policy);

    await this.promotionRepository.save({
      policyId: policy.id,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      promotedById: userId,
      note: dto.note,
    });

    if (nextStatus === PolicyStatus.ACTIVE) {
      await this.kafkaProducer.publishPolicyUpdate({
        tenantId,
        policyId: policy.id,
        policyName: policy.name,
        version: policy.version,
        previousStatus,
        newStatus: nextStatus,
        changedBy: userId || '',
        metadata: { promotionNote: dto.note },
      });
    }

    return policy;
  }

  async demote(
    tenantId: string,
    id: string,
    dto: PromotePolicyDto,
    userId?: string,
  ): Promise<PolicyResponseDto> {
    const policy = await this.findOne(tenantId, id);

    const previousStatus = policy.status;
    let nextStatus: PolicyStatus;

    switch (policy.status) {
      case PolicyStatus.REVIEW:
        nextStatus = PolicyStatus.DRAFT;
        break;
      case PolicyStatus.ACTIVE:
        nextStatus = PolicyStatus.REVIEW;
        break;
      case PolicyStatus.DEPRECATED:
        nextStatus = PolicyStatus.ACTIVE;
        break;
      default:
        throw new BadRequestException(`Cannot demote from ${policy.status}`);
    }

    policy.status = nextStatus;
    await this.policyRepository.save(policy);

    await this.promotionRepository.save({
      policyId: policy.id,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      promotedById: userId,
      note: dto.note,
    });

    return policy;
  }

  async getVersions(tenantId: string, id: string): Promise<PolicyVersionResponseDto[]> {
    const policy = await this.findOne(tenantId, id);
    return this.versionRepository.find({
      where: { policyId: policy.id },
      order: { version: 'DESC' },
    });
  }

  async getVersion(
    tenantId: string,
    id: string,
    version: number,
  ): Promise<PolicyVersionResponseDto> {
    const policy = await this.findOne(tenantId, id);
    const pv = await this.versionRepository.findOne({
      where: { policyId: policy.id, version },
    });
    if (!pv) {
      throw new NotFoundException(`Version ${version} not found`);
    }
    return pv;
  }
}
