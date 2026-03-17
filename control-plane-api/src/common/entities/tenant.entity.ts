import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Policy } from './policy.entity';
import { Agent } from '../../registry/entities/agent.entity';
import { Skill } from '../../registry/entities/skill.entity';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ type: 'jsonb', default: '{}' })
  settings: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.tenant)
  users: User[];

  @OneToMany(() => Policy, (policy) => policy.tenant)
  policies: Policy[];

  @OneToMany(() => Agent, (agent) => agent.tenant)
  agents: Agent[];

  @OneToMany(() => Skill, (skill) => skill.tenant)
  skills: Skill[];
}
