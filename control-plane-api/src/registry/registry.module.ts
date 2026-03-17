import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';
import {
  LlmModel,
  Agent,
  Skill,
  PolicyBinding,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([LlmModel, Agent, Skill, PolicyBinding]),
  ],
  controllers: [RegistryController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
