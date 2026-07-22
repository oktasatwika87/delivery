import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import type { SendChatMessageInput } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get('rooms/:roomId/messages')
  list(@Param('roomId', new ParseUUIDPipe()) roomId: string) {
    return this.service.listByRoom(roomId);
  }

  @Post('messages')
  send(
    @Body() input: SendChatMessageInput,
    @CurrentUser('id') senderId: string,
  ) {
    return this.service.send(input, senderId);
  }
}
