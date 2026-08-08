/**
 * Manual mock for @delivery/shared
 *
 * Exports minimal set yang dipakai oleh OrdersService dan tests.
 * Kontrak: @delivery/shared/export-order.ts
 *
 * NOTE:
 * - Stale dist: sudah difix via prebuild hook di apps/backend/package.json.
 *   `pnpm build` di backend auto-build @delivery/shared duluan.
 * - Mock drift: MASIH OPEN. ESM/CJS interop issue menyebabkan jest tidak bisa
 *   resolve @delivery/shared (ESM) langsung dari CommonJS test context.
 *   Selama mock ini ada, setiap field baru di shared/src HARUS di-sync manual ke
 *   mock ini atau test akan fail saat mock tidak match real source.
 *   Fix total: investigasi apakah jest bisa dikonfigurasi untuk ESM shared tanpa
 *   mock, atau align module format antara backend (CJS) dan shared (ESM).
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
  /** Driver yang cancel order ini (via cancel mid-delivery). */
  cancelledBy?: string;
  /** Alasan cancel yang diberikan driver. */
  cancelReason?: string;
}

export interface CreateOrderInput {
  items: Omit<OrderItem, 'id'>[];
  deliveryAddress: DeliveryAddress;
  notes?: string;
}
