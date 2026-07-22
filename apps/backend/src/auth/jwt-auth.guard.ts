import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard generik berbasis passport-jwt. Mount dengan @UseGuards(JwtAuthGuard)
 * di controller atau method. Tanpa token / token invalid -> 401 otomatis.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}