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
   * Idempotency key — UUID v4-based identifier for COD sync.
   *
   * Format: `cod:${uuid}` where `uuid` is RFC 4122 v4. Generated once
   * client-side when driver taps "Terima Cash COD" and persisted on the
   * local row. Stability across retries is guaranteed by the fact that
   * the key is read from the row (not regenerated). Prevents double-charge
   * via unique constraint on this column.
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

  /**
   * Timestamp when COD was flagged as orphaned (driver collected COD offline,
   * but order was reassigned/cancelled before sync). Server-side flag via
   * POST /payments/:orderId/flag-orphaned.
   */
  orphanedAt?: string;

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
