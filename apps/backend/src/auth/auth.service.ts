import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { UserRole } from '@delivery/shared';

import { LoginDto, RegisterDto } from './auth.dto';
import { AuthenticatedUser } from './auth.types';

/**
 * Bcrypt cost factor. 10 = ~100ms per hash di CPU modern — cukup kuat untuk
 * kebanyakan threat model mobile tanpa bikin login/register terasa lambat.
 */
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<{ token: string; user: AuthenticatedUser }> {
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing) {
      throw new ConflictException(`Phone ${dto.phone} already registered`);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const row = await this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        role: dto.role ?? UserRole.CUSTOMER,
        name: dto.name,
        phone: dto.phone,
        passwordHash,
      },
    });

    return this.issueToken(row.id, row.role, row.name, row.phone);
  }

  async login(dto: LoginDto): Promise<{ token: string; user: AuthenticatedUser }> {
    const row = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!row || !row.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, row.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueToken(row.id, row.role, row.name, row.phone);
  }

  private issueToken(
    id: string,
    role: UserRole,
    name: string,
    phone: string,
  ): { token: string; user: AuthenticatedUser } {
    const token = this.jwt.sign({ sub: id, role });
    return {
      token,
      user: { id, role, name, phone, version: 1 },
    };
  }
}
