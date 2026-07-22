import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { SendChatMessageInput } from '@delivery/shared';

import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get('rooms/:roomId/messages')
  list(@Param('roomId', new ParseUUIDPipe()) roomId: string) {
    return this.service.listByRoom(roomId);
  }

  @Post('messages')
  send(@Body() input: SendChatMessageInput) {
    return this.service.send(input);
  }
}
