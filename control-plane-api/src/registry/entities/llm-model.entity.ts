import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ModelProvider {
  TOGETHER = 'together',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  CUSTOM = 'custom',
}

@Entity('llm_models')
export class LlmModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, type: 'varchar' })
  provider: ModelProvider;

  @Column({ length: 255 })
  modelId: string;

  @Column({ type: 'text', nullable: true })
  endpointUrl: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  pricePer1kInputTokens: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  pricePer1kOutputTokens: number;

  @Column({ type: 'int', default: 60 })
  defaultRateLimit: number;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
