import {
  IsArray,
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
