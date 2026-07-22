import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';

import type { SyncPullResponse, SyncPushPayload, SyncPushResponse } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('push')
  push(
    @Body() payload: SyncPushPayload,
    @CurrentUser('id') userId: string,
  ): Promise<SyncPushResponse> {
    if (!payload.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required and cannot be empty');
    }
    if (payload.userId !== userId) {
      throw new ForbiddenException('userId mismatch');
    }
    return this.service.applyPush(payload);
  }

  @Get('pull')
  pull(
    @Query('deviceId') deviceId: string,
    @CurrentUser('id') userId: string,
    @Query('since') since?: string,
  ): Promise<SyncPullResponse> {
    if (!deviceId?.trim()) {
      throw new BadRequestException('deviceId query parameter is required and cannot be empty');
    }
    return this.service.pullSince(deviceId, userId, since ?? null);
  }
}
