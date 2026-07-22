import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';

import type { SyncPullResponse, SyncPushPayload, SyncPushResponse } from '@delivery/shared';

import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('push')
  push(@Body() payload: SyncPushPayload): Promise<SyncPushResponse> {
    if (!payload.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required and cannot be empty');
    }
    if (!payload.userId?.trim()) {
      throw new BadRequestException('userId is required and cannot be empty');
    }
    return this.service.applyPush(payload);
  }

  @Get('pull')
  pull(
    @Query('deviceId') deviceId: string,
    @Query('since') since?: string,
  ): Promise<SyncPullResponse> {
    if (!deviceId?.trim()) {
      throw new BadRequestException('deviceId query parameter is required and cannot be empty');
    }
    return this.service.pullSince(deviceId, since ?? null);
  }
}