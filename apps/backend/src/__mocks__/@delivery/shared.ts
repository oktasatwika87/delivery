/**
 * Manual mock for @delivery/shared
 *
 * Exports minimal set yang dipakai oleh OrdersService dan tests.
 * Kontrak: @delivery/shared/export-order.ts
 */

export const OrderStatus = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  ASSIGNED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  DRIVER: 'DRIVER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  notes?: string;
}

export interface DeliveryAddress {
  recipientName: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  coordinates?: [number, number];
  [key: string]: string | number | boolean | object | null | undefined;
}

export interface Order {
  id: string;
  customerId: string;
  driverId?: string;
  status: OrderStatus;
  items: OrderItem[];
  deliveryAddress: DeliveryAddress;
  totalCents: number;
  currency: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateOrderInput {
  items: Omit<OrderItem, 'id'>[];
  deliveryAddress: DeliveryAddress;
  notes?: string;
}
