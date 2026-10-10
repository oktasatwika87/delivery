import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { UserRole } from '@delivery/shared';

import { JwtPayload } from './auth.types';
import { readJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readJwtSecret(config),
    });
  }

  /**
   * Return value di sini di-inject ke req.user. Cukup kembalikan payload,
   * JwtAuthGuard yang akan handle error.
   */
  validate(payload: JwtPayload): { id: string; role: UserRole } {
    if (!payload?.sub) {
      throw new UnauthorizedException('Isi token tidak valid');
    }
    return { id: payload.sub, role: payload.role };
  }
}