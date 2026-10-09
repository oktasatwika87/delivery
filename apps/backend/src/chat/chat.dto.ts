import { IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Request body untuk POST /chat/messages dan socket send_message. */
export class SendChatMessageDto {
  @IsOptional()
  @IsUUID('4', { message: 'id harus UUID v4' })
  id?: string;

  @IsUUID('4', { message: 'roomId harus UUID v4' })
  roomId!: string;

  @IsString()
  @IsNotEmpty({ message: 'body tidak boleh kosong' })
  @MaxLength(2000, { message: 'body maksimal 2000 karakter' })
  body!: string;

  @IsOptional()
  @IsObject()
  attachment?: object;

  @IsOptional()
  @IsString()
  clientCreatedAt?: string;
}
