import { Module } from '@nestjs/common';

import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [ChatModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}