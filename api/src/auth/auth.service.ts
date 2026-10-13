import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { Role, User } from '../users/user.entity';
import { CreateUserDto, LoginDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private jwt: JwtService,
  ) {}

  async setupFirstAdmin(dto: CreateUserDto) {
    const count = await this.users.count();
    if (count > 0) {
      throw new ConflictException('Setup already completed');
    }
    return this.create(dto, Role.Admin);
  }

  async create(dto: CreateUserDto, role: Role) {
    const exists = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) throw new ConflictException('Email already used');
    const user = await this.users.save(
      this.users.create({
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash: await argon2.hash(dto.password),
        role,
      }),
    );
    return this.publicUser(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    const ok = user && (await argon2.verify(user.passwordHash, dto.password));
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    return { accessToken, user: this.publicUser(user) };
  }

  publicUser(u: User) {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }
}
