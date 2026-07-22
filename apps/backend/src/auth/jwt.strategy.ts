import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { UserRole } from '@delivery/shared';

import { JWT_SECRET_DEFAULT, JWT_SECRET_ENV, JwtPayload } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>(JWT_SECRET_ENV) ?? JWT_SECRET_DEFAULT,
    });
  }

  /**
   * Return value di sini di-inject ke req.user. Cukup kembalikan payload —
   * JwtAuthGuard yang akan handle error.
   */
  validate(payload: JwtPayload): { id: string; role: UserRole } {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return { id: payload.sub, role: payload.role };
  }
}