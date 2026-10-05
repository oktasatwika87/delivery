import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import type { SendChatMessageInput } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly service: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('rooms/:roomId/messages')
  async list(
    @Param('roomId', new ParseUUIDPipe()) roomId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.service.validateRoomAccess(roomId, userId);
    return this.service.listByRoom(roomId);
  }

  @Post('messages')
  async send(
    @Body() input: SendChatMessageInput,
    @CurrentUser('id') senderId: string,
  ) {
    const { message, created } = await this.service.send(input, senderId);
    if (created) {
      this.gateway.emitNewMessage(message);
    }
    return message;
  }
}
