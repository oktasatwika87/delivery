import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators';

import type { ChatMessageStatus } from '@delivery/shared';

export class ChatMessageModel extends Model {
  static override table = 'chat_messages';

  @text('room_id') roomId!: string;
  @text('sender_id') senderId!: string;
  @text('body') body!: string;
  @text('attachment_json') attachmentJson?: string;
  @text('status') status!: ChatMessageStatus;
  @field('client_created_at') clientCreatedAt!: number;
  @field('server_created_at') serverCreatedAt?: number;
  @field('server_version') serverVersion!: number;
  @date('deleted_at') deletedAt?: Date;

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}
