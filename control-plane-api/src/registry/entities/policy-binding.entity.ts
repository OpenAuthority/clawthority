import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Policy } from '../../common/entities';

export enum PolicyTargetType {
  MODEL = 'model',
  AGENT = 'agent',
  SKILL = 'skill',
}

@Entity('policy_bindings')
@Unique(['policyId', 'targetType', 'targetId'])
export class PolicyBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  policyId: string;

  @ManyToOne(() => Policy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'policyId' })
  policy: Policy;

  @Column({ length: 50, type: 'varchar' })
  targetType: PolicyTargetType;

  @Column({ type: 'uuid' })
  targetId: string;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
