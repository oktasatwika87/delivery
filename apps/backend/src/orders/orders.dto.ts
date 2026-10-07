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
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OrderStatus } from '@delivery/shared';

/**
 * Validator coordinates: tepat dua angka [lng, lat], lng -180 sampai 180,
 * lat -90 sampai 90. Tanpa ini, koordinat yang tertukar atau rusak tetap
 * tersimpan dan driver diarahkan ke tempat yang salah.
 */
@ValidatorConstraint({ name: 'IsLngLatTuple', async: false })
class IsLngLatTupleConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (!Array.isArray(value)) return false;
    if (value.length !== 2) return false;
    const [lng, lat] = value;
    if (typeof lng !== 'number' || typeof lat !== 'number') return false;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat < -90 || lat > 90) return false;
    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'coordinates harus [lng, lat] dengan lng -180 sampai 180 dan lat -90 sampai 90';
  }
}

export function IsLngLatTuple(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsLngLatTupleConstraint,
    });
  };
}

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
  @IsLngLatTuple()
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
