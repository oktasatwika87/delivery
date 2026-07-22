/**
 * Domain: Payment
 *
 * Dipisah dari Order supaya driver bisa collect payment saat delivery
 * tanpa coupling ke status order. 1 Order bisa punya beberapa Payment
 * (down-payment + remaining) atau void/refund.
 */

export const PaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  EWALLET: 'EWALLET',
  BANK_TRANSFER: 'BANK_TRANSFER',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  VOIDED: 'VOIDED',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface Payment {
  id: string;
  orderId: string;

  /**
   * Idempotency key — UUID generated client-side SEBELUM push.
   * Memungkinkan retry tanpa double-charge: kalau record dengan idempotencyKey
   * ini sudah ada di DB, server skip insert & return record lama.
   */
  idempotencyKey: string;

  method: PaymentMethod;
  status: PaymentStatus;

  /** Amount dalam cents, sesuai Order.totalCents. */
  amountCents: number;
  currency: string;

  /** External gateway reference (Stripe charge id, midtrans tx id, dll). */
  externalRef?: string;

  /** Untuk split payment: 'PAYMENT' (utama), 'TIP', 'REFUND'. */
  kind: 'PAYMENT' | 'TIP' | 'REFUND';

  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreatePaymentInput {
  orderId: string;
  idempotencyKey: string;
  method: PaymentMethod;
  amountCents: number;
  currency: string;
}
