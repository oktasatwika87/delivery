import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OrderStatus } from '@delivery/shared';

/** Item dalam order. */
export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity!: number;

  @IsNumber()
  @Min(1, { message: 'Unit price must be at least 1 cent' })
  unitPriceCents!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Alamat pengiriman. */
export class DeliveryAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'Recipient name is required' })
  recipientName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'Street address is required' })
  street!: string;

  @IsString()
  @IsNotEmpty({ message: 'City is required' })
  city!: string;

  @IsString()
  @IsNotEmpty({ message: 'Postal code is required' })
  postalCode!: string;

  /** [lng, lat] — konsisten dengan GeoJSON convention. */
  @IsOptional()
  coordinates?: [number, number];

  /** Index signature for Prisma Json compatibility. */
  [key: string]: string | number | boolean | object | null | undefined | [number, number] | undefined;
}

/** Request body untuk POST /orders. */
export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  @ArrayMinSize(1, { message: 'At least one item is required' })
  items!: OrderItemDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Request body untuk PATCH /orders/:id/status.
 *
 * Endpoint ini mempersempit — hanya menerima dua transisi:
 * PREPARING → OUT_FOR_DELIVERY dan OUT_FOR_DELIVERY → DELIVERED,
 * dilakukan driver pemilik order. ValidationPipe global di main.ts
 * mengembalikan 400 untuk body yang tidak lolos aturan di sini.
 *
 * Status di sini adalah full OrderStatus enum (bukan hanya dua nilai yang
 * diizinkan) — controller yang menyempitkan ke dua nilai, sehingga
 * respons 403 untuk target lain seragam dengan pola cancel/reject.
 */
export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus, { message: 'status harus salah satu dari OrderStatus enum' })
  status!: OrderStatus;

  @IsInt({ message: 'version harus bilangan bulat' })
  @Min(1, { message: 'version minimal 1' })
  version!: number;
}
