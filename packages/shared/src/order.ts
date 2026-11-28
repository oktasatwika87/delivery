/**
 * Domain: Order
 *
 * Alur status: PENDING ke CONFIRMED ke PREPARING ke OUT_FOR_DELIVERY
 *           ke DELIVERED
 *           -or- ke CANCELLED (bisa dari status manapun sebelum DELIVERED)
 */

import type { PaymentMethod, PaymentStatus } from './payment.js';

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

/**
 * Batas menit tanpa kontak dari driver sebelum customer boleh minta driver lain.
 */
export const DRIVER_UNREACHABLE_MINUTES = 30;

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
  /** [lng, lat], konsisten dengan GeoJSON convention. */
  coordinates?: [number, number];
  /** Index signature untuk type compatibility dengan Prisma Json fields (InputJsonValue | null). */
  [key: string]: string | number | boolean | object | null | undefined;
}

export interface Order {
  id: string;
  customerId: string;
  driverId?: string;

  status: OrderStatus;
  items: OrderItem[];
  deliveryAddress: DeliveryAddress;

  /** Total dalam sen/cents (integer) untuk hindari floating-point bug. */
  totalCents: number;
  currency: string; // ISO 4217: 'IDR', 'USD', dll

  /** Catatan driver/customer, digunakan untuk chat cepat terkait order ini. */
  notes?: string;

  createdAt: string; // ISO 8601
  updatedAt: string;
  /** Optimistic concurrency control, backend reject update kalau client kirim value lama. */
  version: number;

  /** Driver yang cancel order ini (via cancel mid-delivery). */
  cancelledBy?: string;
  /** Alasan cancel yang diberikan driver. */
  cancelReason?: string;

  /**
   * Hanya diisi di GET /orders/:id untuk customer order itu. Berisi waktu
   * kontak terakhir driver (ISO) kalau customer sudah boleh minta driver
   * lain, selain itu null.
   */
  driverUnreachableSince?: string | null;

  /**
   * Ringkasan pembayaran order ini, hanya diisi di GET /orders/:id untuk
   * customer order itu. Null kalau belum ada pembayaran yang tercatat.
   */
  payment?: { method: PaymentMethod; status: PaymentStatus } | null;
}

/** Request body untuk create order dari mobile. */
export interface CreateOrderInput {
  items: Omit<OrderItem, 'id'>[];
  deliveryAddress: DeliveryAddress;
  notes?: string;
}

/** Valid state transitions, dipakai oleh backend validator. */
export const ORDER_ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  ASSIGNED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};