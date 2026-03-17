import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../common/entities';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findAllByTenant(tenantId: string): Promise<UserResponseDto[]> {
    return this.userRepository.find({ where: { tenantId } });
  }

  async findOne(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async create(tenantId: string, dto: CreateUserDto): Promise<UserResponseDto> {
    const user = this.userRepository.create({ ...dto, tenantId });
    return this.userRepository.save(user);
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.findOne(tenantId, id);
    Object.assign(user, dto);
    return this.userRepository.save(user);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const user = await this.findOne(tenantId, id);
    await this.userRepository.remove(user);
  }
}
